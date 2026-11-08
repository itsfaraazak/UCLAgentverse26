import unittest

from backend import server, versioning


class VersioningTests(unittest.TestCase):
    def test_one_decision_checks_and_stale_requests(self):
        store = server.Store()
        state = store.run(store.snapshot()["draft"], 0)
        base = state["repository"]["branches"]["main"]
        with self.assertRaises(server.APIError):
            store.review("approve", state["version"], base)
        state = store.review("request_changes", state["version"], base)
        self.assertEqual(state["review"]["version"], state["version"])
        state = store.repository_action("merge", {"left": "investigator-1", "right": "investigator-2"}, state["version"])
        self.assertIsNone(state["review"])
        with self.assertRaises(server.APIError):
            store.review("approve", state["version"], base)
        state = store.repository_action("resolve", {"summary_branch": "investigator-1"}, state["version"])
        oid = state["repository"]["branches"]["main"]
        previous_version = state["version"]
        state = store.review("approve", previous_version, oid)
        self.assertEqual(state["review"], {"decision": "approve", "version": state["version"], "commit": oid})
        with self.assertRaises(server.APIError):
            store.review("request_changes", previous_version, oid)
        with self.assertRaises(server.APIError):
            store.repository_action("approve", {"commit": oid}, state["version"])
        state = store.review("request_changes", state["version"], oid)
        self.assertEqual(state["review"]["decision"], "request_changes")
        self.assertNotIn("review", state["repository"])
        state = store.repository_action("comment", {"commit": oid, "field": "claims", "text": "Review"}, state["version"])
        self.assertIsNone(state["review"])

    def test_conflict_resolution_comments_and_hash_approval(self):
        store = server.Store()
        state = store.run(store.snapshot()["draft"], 0)
        repo = state["repository"]
        original = repo["branches"]["main"]
        state = store.repository_action("merge", {"left": "investigator-1", "right": "investigator-2"}, state["version"])
        self.assertTrue(state["repository"]["merge_result"]["conflicts"])
        self.assertEqual(state["repository"]["branches"]["main"], original)
        state = store.repository_action("resolve", {"summary_branch": "investigator-1"}, state["version"])
        repo = state["repository"]
        oid = repo["branches"]["main"]
        self.assertEqual(len(repo["objects"][oid]["parents"]), 2)
        self.assertTrue(versioning.diff(repo, original, oid))
        state = store.repository_action("comment", {"commit": oid, "field": "claims", "text": "Check source scope"}, state["version"])
        state = store.review("approve", state["version"], oid)
        self.assertEqual(state["review"]["commit"], oid)
        with self.assertRaises(server.APIError):
            store.review("approve", state["version"], original)
        state = store.draft("Review governance", state["draft_revision"])
        self.assertNotIn("repository", state)

    def test_content_identity_and_parent_identity(self):
        objects = {}
        artifact = {"summary": "test", "claims": []}
        first = versioning.commit(objects, artifact)
        self.assertEqual(first, versioning.commit(objects, artifact))
        self.assertNotEqual(first, versioning.commit(objects, artifact, [first]))

    def test_merge_uses_latest_common_ancestor(self):
        objects = {}
        base = versioning.commit(objects, {"summary": "original", "claims": []})
        common = versioning.commit(objects, {"summary": "updated", "claims": []}, [base])
        left = versioning.commit(objects, {"summary": "updated", "claims": [{"text": "claim", "source_ids": ["A"]}]}, [common])
        right = versioning.commit(objects, {"summary": "changed", "claims": []}, [common])
        repo = {"objects": objects, "branches": {"main": base, "left": left, "right": right}, "base": base}
        result = versioning.merge(repo, "left", "right")
        self.assertFalse(result["conflicts"])
        self.assertEqual(objects[result["commit"]]["artifact"]["summary"], "changed")
        self.assertEqual(len(objects[result["commit"]]["artifact"]["claims"]), 1)

    def test_no_common_ancestor_rejected(self):
        objects = {}
        first = versioning.commit(objects, {"summary": "one", "claims": []})
        second = versioning.commit(objects, {"summary": "two", "claims": []})
        with self.assertRaises(ValueError):
            versioning.merge_base(objects, first, second)

    def test_revision_history_stale_edits_and_approval(self):
        store = server.Store()
        state = store.run(store.snapshot()["draft"], 0)
        repo = state["repository"]
        old = repo["branches"]["investigator-1"]
        artifact = dict(repo["objects"][old]["artifact"])
        artifact["summary"] = "Human oversight and governance."
        state = store.repository_action("revise", {"branch": "investigator-1", "commit": old,
                                                    "artifact": artifact}, state["version"])
        repo = state["repository"]
        new = repo["branches"]["investigator-1"]
        self.assertEqual(repo["objects"][new]["parents"], [old])
        self.assertIn(old, repo["objects"])
        with self.assertRaises(server.APIError):
            store.repository_action("revise", {"branch": "investigator-1", "commit": old,
                                               "artifact": artifact}, state["version"])
        state = store.repository_action("merge", {"left": "investigator-1", "right": "investigator-2"}, state["version"])
        state = store.repository_action("resolve", {"summary_branch": "investigator-1"}, state["version"])
        main = state["repository"]["branches"]["main"]
        state = store.review("approve", state["version"], main)
        revised = dict(state["repository"]["objects"][main]["artifact"])
        revised["summary"] = "Evidence and uncertainty are limited."
        state = store.repository_action("revise", {"branch": "main", "commit": main,
                                                    "artifact": revised}, state["version"])
        self.assertIsNone(state["review"])
        with self.assertRaises(server.APIError):
            store.review("approve", state["version"], main)
        with self.assertRaises(server.APIError):
            store.repository_action("merge", {"left": "investigator-1", "right": "investigator-2"}, state["version"])

    def test_revision_rejects_unsafe_or_invalid_artifacts(self):
        store = server.Store()
        state = store.run(store.snapshot()["draft"], 0)
        repo = state["repository"]
        oid = repo["branches"]["investigator-1"]
        for artifact in (
            {"summary": "patient Jane Doe", "claims": []},
            {"summary": "Human oversight and governance.", "claims": [{"text": "Human oversight and uncertainty.", "source_ids": ["unknown"]}]},
            {"summary": "Human oversight and governance.", "claims": [], "extra": "data"},
        ):
            with self.subTest(artifact=artifact), self.assertRaises(server.APIError):
                store.repository_action("revise", {"branch": "investigator-1", "commit": oid,
                                                   "artifact": artifact}, state["version"])
        self.assertEqual(store.snapshot()["repository"], repo)

    def test_multiple_best_merge_bases_rejected(self):
        objects = {}
        root = versioning.commit(objects, {"summary": "root", "claims": []})
        a = versioning.commit(objects, {"summary": "a", "claims": []}, [root])
        b = versioning.commit(objects, {"summary": "b", "claims": []}, [root])
        left = versioning.commit(objects, {"summary": "left", "claims": []}, [a, b])
        right = versioning.commit(objects, {"summary": "right", "claims": []}, [b, a])
        with self.assertRaisesRegex(ValueError, "multiple merge bases"):
            versioning.merge_base(objects, left, right)
