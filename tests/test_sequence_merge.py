import http.client
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from backend import server
from backend.git_history import GitHistory, InvalidInput, MergeConflict, StaleHead


def sub(position, reference, alternate):
    return {"position": position, "reference": reference, "alternate": alternate}


class SequenceMergeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.h = GitHistory(Path(self.temp.name) / "history.git")
        self.base = self.h.save("target note", None, "base")["head"]
        self.h.create_branch("source", "main", self.base)

    def save(self, branch, changes):
        return self.h.sequence_save(changes, self.h.read(branch)["head"], branch)["head"]

    def commit(self, preview, **kwargs):
        return self.h.sequence_merge("main", "source", preview["target"], preview["source"],
                                     True, **kwargs)

    def test_disjoint_merge_preserves_tree_and_both_parents(self):
        target = self.save("main", [sub(7, "E", "V")])
        source = self.save("source", [sub(8, "E", "A")])
        preview = self.h.sequence_merge_preview("main", "source")
        self.assertEqual((preview["base"], preview["target"], preview["source"]),
                         (self.base, target, source))
        self.assertEqual(preview["merged_substitutions"], [sub(7, "E", "V"), sub(8, "E", "A")])
        self.assertEqual(preview["conflicts"], [])
        result = self.commit(preview)
        self.assertEqual(result["substitutions"], preview["merged_substitutions"])
        self.assertEqual(self.h.read()["content"], "target note")
        parents = self.h._git("show", "-s", "--format=%P", result["head"]).stdout.decode().split()
        self.assertEqual(parents, [target, source])
        self.assertEqual(self.h.read("source")["head"], source)
        self.assertEqual(self.h.sequence_merge_preview("main", "source")["base"], source)
        self.assertEqual(self.commit(self.h.sequence_merge_preview("main", "source"))["status"],
                         "source_already_merged")

    def test_conflict_reversion_and_identical_change(self):
        root = self.save("main", [sub(7, "E", "V")])
        self.h.create_branch("other", "main", root)
        self.save("main", [])
        self.save("other", [sub(7, "E", "A")])
        preview = self.h.sequence_merge_preview("main", "other")
        self.assertEqual(preview["conflicts"], [{"position": 7, "old": "V", "target": "E", "source": "A"}])
        with self.assertRaises(MergeConflict):
            self.h.sequence_merge("main", "other", preview["target"], preview["source"], True)
        self.assertEqual(self.h.read()["head"], preview["target"])
        self.save("other", [])
        preview = self.h.sequence_merge_preview("main", "other")
        self.assertEqual(preview["conflicts"], [])
        self.assertEqual(preview["merged_substitutions"], [])
        self.h.sequence_merge("main", "other", preview["target"], preview["source"], True)

    def test_reversion_propagates(self):
        self.save("main", [sub(7, "E", "V")])
        head = self.h.read()["head"]
        self.h.create_branch("revert", "main", head)
        self.save("revert", [])
        self.save("main", [sub(7, "E", "V"), sub(8, "E", "A")])
        preview = self.h.sequence_merge_preview("main", "revert")
        self.assertEqual(preview["merged_substitutions"], [sub(8, "E", "A")])

    def test_fast_forward_case_preserves_target_note(self):
        source = self.save("source", [sub(7, "E", "V")])
        result = self.commit(self.h.sequence_merge_preview("main", "source"))
        self.assertNotEqual(result["head"], source)
        self.assertEqual(self.h.read()["content"], "target note")

    def test_stale_and_transaction_races(self):
        for moving in ("main", "source"):
            with self.subTest(moving=moving):
                preview = self.h.sequence_merge_preview("main", "source")
                if moving == "source":
                    self.save("source", [sub(7, "E", "V")])
                else:
                    self.h.save("changed main", preview["target"], "change", "main")
                with self.assertRaises(StaleHead):
                    self.commit(preview)
        self.save("source", [sub(7, "E", "A")])
        for moving in ("main", "source"):
            with self.subTest(transaction_race=moving):
                preview = self.h.sequence_merge_preview("main", "source")
                git = self.h._git
                def racing_git(*args, **kwargs):
                    if args[:2] == ("update-ref", "--stdin"):
                        head = self.h.read(moving)["head"]
                        self.h.save("race " + moving, head, "race", moving)
                    return git(*args, **kwargs)
                with patch.object(self.h, "_git", side_effect=racing_git):
                    with self.assertRaises(StaleHead):
                        self.commit(preview)
                if moving == "source":
                    self.assertEqual(self.h.read()["head"], preview["target"])

    def test_non_first_parent_ancestry_used_as_base(self):
        self.save("source", [sub(7, "E", "V")])
        source = self.h.read("source")["head"]
        self.commit(self.h.sequence_merge_preview("main", "source"))
        self.save("source", [sub(7, "E", "V"), sub(8, "E", "A")])
        preview = self.h.sequence_merge_preview("main", "source")
        self.assertEqual(preview["base"], source)
        self.assertEqual(preview["merged_substitutions"], [sub(7, "E", "V"), sub(8, "E", "A")])

    def test_source_note_change_rejected_unless_target_already_matches(self):
        source = self.h.save("source note", self.base, "source note", "source")["head"]
        preview = self.h.sequence_merge_preview("main", "source")
        self.assertTrue(preview["notes_conflict"])
        with self.assertRaisesRegex(MergeConflict, "note"):
            self.commit(preview)
        self.assertEqual(self.h.read()["head"], self.base)
        self.assertEqual(self.h.read("source")["head"], source)
        self.h.save("source note", self.base, "matching note", "main")
        preview = self.h.sequence_merge_preview("main", "source")
        self.assertFalse(preview["notes_conflict"])
        self.assertEqual(self.commit(preview)["status"], "merged")

    def test_merge_after_rollback_reports_ancestry_not_sequence_inclusion(self):
        self.save("source", [sub(7, "E", "V")])
        merged = self.commit(self.h.sequence_merge_preview("main", "source"))
        rolled_back = self.h.sequence_rollback(self.base, merged["head"])
        self.assertEqual(rolled_back["substitutions"], [])
        result = self.commit(self.h.sequence_merge_preview("main", "source"))
        self.assertEqual(result["status"], "source_already_merged")
        self.assertEqual(result["head"], rolled_back["head"])
        self.assertEqual(result["substitutions"], [])

    def test_validation_and_same_branch(self):
        self.assertEqual(self.commit(self.h.sequence_merge_preview("main", "source"))["status"],
                         "source_already_merged")
        same = self.h.sequence_merge_preview("main", "main")
        self.assertEqual(self.h.sequence_merge("main", "main", same["target"], same["source"], True)["status"],
                         "source_already_merged")
        with self.assertRaises(InvalidInput):
            self.h.sequence_merge("main", "source", self.base, self.base, 1)
        for name in ("../bad", "-bad", "missing"):
            with self.assertRaises(InvalidInput):
                self.h.sequence_merge_preview("main", name)
        empty = GitHistory(Path(self.temp.name) / "empty.git")
        with self.assertRaises(InvalidInput):
            empty.sequence_merge_preview("main", "main")
        self.assertFalse(empty.path.exists())


class MergeHTTPTests(unittest.TestCase):
    def test_preview_and_confirm_http_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            history = GitHistory(Path(tmp) / "history.git")
            base = history.save("note", None, "base")["head"]
            history.create_branch("source", "main", base)
            history.sequence_save([sub(7, "E", "V")], base, "source")
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            with patch.object(server, "NOTES", history):
                thread.start()
                try:
                    def request(method, path, body=None):
                        conn = http.client.HTTPConnection("127.0.0.1", httpd.server_port, timeout=5)
                        conn.request(method, path, json.dumps(body) if body is not None else None,
                                     {"Content-Type": "application/json"})
                        response = conn.getresponse()
                        value = response.status, json.loads(response.read())
                        conn.close()
                        return value
                    status, preview = request("GET", "/api/sequence/merge/preview?target_branch=main&source_branch=source")
                    self.assertEqual(status, 200)
                    self.assertEqual(preview["target"], base)
                    self.assertEqual(preview["source"], history.read("source")["head"])
                    self.assertEqual(preview["merged_substitutions"], [sub(7, "E", "V")])
                    self.assertFalse(preview["notes_conflict"])
                    body = {"target_branch": "main", "source_branch": "source",
                            "expected_target_head": preview["target"], "expected_source_head": preview["source"],
                            "confirmed": False}
                    self.assertEqual(request("POST", "/api/sequence/merge", body)[0], 400)
                    body["confirmed"] = True
                    self.assertEqual(request("POST", "/api/sequence/merge", body)[1]["status"], "merged")
                    self.assertEqual(request("POST", "/api/sequence/merge", body)[0], 409)
                    head = history.read()["head"]
                    history.create_branch("conflict", "main", head)
                    history.sequence_save([sub(7, "E", "A")], head, "main")
                    history.sequence_save([sub(7, "E", "D")], head, "conflict")
                    status, conflict = request("GET", "/api/sequence/merge/preview?target_branch=main&source_branch=conflict")
                    self.assertEqual(status, 200)
                    self.assertEqual(conflict["conflicts"], [{"position": 7, "old": "V", "target": "A", "source": "D"}])
                    body.update(source_branch="conflict", expected_target_head=conflict["target"],
                                expected_source_head=conflict["source"])
                    self.assertEqual(request("POST", "/api/sequence/merge", body)[0], 409)
                    self.assertEqual(history.read()["head"], conflict["target"])
                    history.create_branch("note-change", "main", conflict["target"])
                    history.save("different note", conflict["target"], "note change", "note-change")
                    status, note_preview = request("GET", "/api/sequence/merge/preview?target_branch=main&source_branch=note-change")
                    self.assertEqual(status, 200)
                    self.assertTrue(note_preview["notes_conflict"])
                    body.update(source_branch="note-change", expected_target_head=note_preview["target"],
                                expected_source_head=note_preview["source"])
                    status, response = request("POST", "/api/sequence/merge", body)
                    self.assertEqual(status, 409)
                    self.assertIn("note", response["error"])
                    self.assertEqual(history.read()["head"], note_preview["target"])
                finally:
                    httpd.shutdown()
                    httpd.server_close()
                    thread.join()
