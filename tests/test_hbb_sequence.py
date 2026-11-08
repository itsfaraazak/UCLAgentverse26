import http.client
import json
import subprocess
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from backend import hbb_sequence, server
from backend.git_history import GitHistory, InvalidInput, StaleHead


class SequenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.history = GitHistory(Path(self.temp.name) / "history.git")
        self.change = [{"position": 7, "reference": "E", "alternate": "V"}]

    def test_reference_and_coordinates(self):
        ref = hbb_sequence.REFERENCE
        self.assertEqual((ref["accession"], ref["sequence_version"], len(ref["sequence"])),
                         ("P68871", 2, 147))
        state = hbb_sequence.make_state(self.change)
        self.assertEqual(state["sequence"][:10], "MVHLTPVEKS")
        self.assertEqual(state["sequence"][7:], ref["sequence"][7:])
        self.assertIn("not a measured or predicted", state["disclaimer"])

    def test_invalid_substitutions(self):
        for changes in ([{"position": 6, "reference": "E", "alternate": "V"}],
                        [{"position": 7, "reference": "E", "alternate": "E"}],
                        [{"position": True, "reference": "M", "alternate": "V"}],
                        [{"position": 148, "reference": "H", "alternate": "V"}],
                        [{"position": 7, "reference": "E", "alternate": "X"}],
                        self.change * 2, [{"position": 7, "reference": "E", "alternate": "V", "patient": "x"}]):
            with self.subTest(changes=changes), self.assertRaises(InvalidInput):
                self.history.sequence_save(changes, None)
        self.assertFalse(self.history.path.exists())

    def test_interleaved_note_and_sequence_history(self):
        note = self.history.save("existing note", None, "note")
        self.assertEqual(self.history.sequence_read()["substitutions"], [])
        self.assertEqual(self.history.diff(note["head"], "sequence.json"), "")
        edit = self.history.sequence_save(self.change, note["head"])
        self.assertEqual(self.history.read()["content"], "existing note")
        self.assertIn("+      \"alternate\": \"V\"", self.history.diff(edit["head"], "sequence.json"))
        next_note = self.history.save("new note", edit["head"], "another note")
        self.assertEqual(self.history.sequence_read()["substitutions"], self.change)
        self.assertEqual(self.history.diff(next_note["head"], "sequence.json"), "")
        with self.assertRaises(StaleHead):
            self.history.sequence_save([], edit["head"])
        reset = self.history.sequence_save([], next_note["head"])
        self.assertEqual(reset["sequence"], hbb_sequence.REFERENCE["sequence"])
        self.assertEqual(GitHistory(self.history.path).sequence_read(), reset)

    def test_sequence_first_preserves_note_api(self):
        state = self.history.sequence_save(self.change, None)
        self.assertEqual(self.history.read()["content"], "")
        note = self.history.save("note", state["head"], "note")
        self.assertEqual(self.history.sequence_read()["head"], note["head"])
        self.assertEqual(self.history.sequence_read()["substitutions"], self.change)

    def test_compare_interleaved_history_and_reversal(self):
        initial = self.history.save("private initial note\n", None, "initial")
        first = self.history.sequence_save(self.change, initial["head"])
        note = self.history.save("private changed note\n", first["head"], "note")
        changes = [{"position": 7, "reference": "E", "alternate": "A"},
                   {"position": 2, "reference": "V", "alternate": "L"}]
        second = self.history.sequence_save(changes, note["head"])

        comparison = self.history.compare(initial["head"], second["head"])
        self.assertEqual(comparison["from"]["sequence"], hbb_sequence.make_state([]))
        self.assertEqual(comparison["to"]["sequence"], hbb_sequence.make_state(changes))
        self.assertEqual(comparison["sequence"]["changes"],
                         [{"position": 2, "old": "V", "new": "L"},
                          {"position": 7, "old": "E", "new": "A"}])
        self.assertEqual(comparison["from"]["note"], "private initial note\n")
        self.assertIn("+private changed note", comparison["notes"]["diff"])
        self.assertNotIn("private", json.dumps(comparison["sequence"]))
        for filename, group in (("sequence.json", "sequence"), ("note.md", "notes")):
            actual = subprocess.check_output(["git", "--git-dir", str(self.history.path), "diff",
                                              "--no-ext-diff", "--no-textconv", "--no-renames",
                                              initial["head"], second["head"], "--", filename]).decode()
            self.assertEqual(comparison[group]["diff"], actual)

        note_only = self.history.compare(first["head"], note["head"])
        self.assertEqual(note_only["sequence"], {"diff": "", "raw_diff": "", "changes": []})
        self.assertNotEqual(note_only["notes"]["diff"], "")
        reverse = self.history.compare(second["head"], initial["head"])
        self.assertEqual(reverse["sequence"]["changes"],
                         [{"position": 2, "old": "L", "new": "V"},
                          {"position": 7, "old": "A", "new": "E"}])
        self.assertEqual(self.history.compare(first["head"], first["head"])["sequence"],
                         {"diff": "", "raw_diff": "", "changes": []})
        reset = self.history.sequence_save([], second["head"])
        self.assertEqual(self.history.compare(second["head"], reset["head"])["sequence"]["changes"],
                         reverse["sequence"]["changes"])

    def test_compare_rejects_invalid_and_unreachable_objects(self):
        with self.assertRaises(InvalidInput):
            self.history.compare("0" * 40, "1" * 40)
        first = self.history.save("note", None, "initial")
        blob = self.history._git("rev-parse", first["head"] + ":note.md").stdout.decode().strip()
        tree = self.history._git("rev-parse", first["head"] + "^{tree}").stdout.decode().strip()
        dangling = self.history._git("commit-tree", tree, data=b"unreachable\n").stdout.decode().strip()
        for invalid in ("main", "", first["head"][:12], "0" * 40, blob, dangling,
                        first["head"].upper(), first["head"] + "^", None):
            for pair in ((invalid, first["head"]), (first["head"], invalid)):
                with self.subTest(pair=pair), self.assertRaises(InvalidInput):
                    self.history.compare(*pair)
        self.assertEqual(self.history.read()["head"], first["head"])

    def test_compare_older_than_history_display_limit(self):
        first = self.history.save("0", None, "initial")
        head = first["head"]
        for index in range(50):
            head = self.history.save(str(index + 1), head, "update")["head"]
        self.assertNotIn(first["head"], [entry["commit"] for entry in self.history.read()["history"]])
        self.assertEqual(self.history.compare(first["head"], head)["from"]["note"], "0")

    def test_presentation_metadata_can_change_without_invalidating_history(self):
        saved = self.history.sequence_save(self.change, None)
        updated_reference = {**hbb_sequence.REFERENCE, "source_url": "https://example.org/new-link"}
        with patch.object(hbb_sequence, "REFERENCE", updated_reference), \
             patch.object(hbb_sequence, "DISCLAIMER", "Updated display text"):
            loaded = self.history.sequence_read()
            self.assertEqual(loaded["head"], saved["head"])
            self.assertEqual(loaded["substitutions"], self.change)
            self.assertEqual(loaded["disclaimer"], "Updated display text")

    def test_concurrent_note_and_sequence_writes(self):
        initial = self.history.save("note", None, "initial")
        barrier = threading.Barrier(2)
        outcomes = []

        def write(action):
            barrier.wait()
            try:
                action()
                outcomes.append("saved")
            except StaleHead:
                outcomes.append("stale")

        threads = [
            threading.Thread(target=write, args=(lambda: self.history.save("new", initial["head"], "note"),)),
            threading.Thread(target=write, args=(lambda: self.history.sequence_save(self.change, initial["head"]),)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
            self.assertFalse(thread.is_alive())
        self.assertCountEqual(outcomes, ["saved", "stale"])
        self.assertEqual(len(self.history.read()["history"]), 2)

    def test_branch_isolation_rollback_and_reachability(self):
        initial = self.history.save("original", None, "initial")
        edit = self.history.sequence_save(self.change, initial["head"])
        self.history.create_branch("experiment/one", "main", edit["head"])
        branch = self.history.save("branch note", edit["head"], "note", "experiment/one")
        main = self.history.save("main note", edit["head"], "note")
        restored = self.history.sequence_rollback(initial["head"], branch["head"], "experiment/one", "restore baseline")
        self.assertEqual(restored["substitutions"], [])
        self.assertEqual(self.history.read("experiment/one")["content"], "branch note")
        self.assertEqual(self.history.read()["head"], main["head"])
        self.assertEqual(restored["history"][0]["message"], "restore baseline")
        self.assertEqual(self.history._git("rev-parse", restored["head"] + "^").stdout.decode().strip(), branch["head"])
        self.assertEqual({b["name"] for b in self.history.branches()["branches"]}, {"main", "experiment/one"})
        with self.assertRaises(StaleHead):
            self.history.sequence_rollback(edit["head"], branch["head"], "experiment/one")
        with self.assertRaises(InvalidInput):
            self.history.sequence_rollback(main["head"], restored["head"], "experiment/one")
        with self.assertRaises(InvalidInput):
            self.history.create_branch("bad\ncreate refs/heads/evil", "main", main["head"])
        with self.assertRaises(StaleHead):
            self.history.create_branch("stale", "main", edit["head"])
        with self.assertRaises(InvalidInput):
            self.history.create_branch("main", "main", main["head"])
        self.assertEqual(self.history.read("experiment/one")["head"], restored["head"])

    def test_branch_first_parent_and_sequence_commit_message(self):
        initial = self.history.sequence_save(self.change, None)
        self.history.create_branch("feature", "main", initial["head"])
        saved = self.history.sequence_save([], initial["head"], "feature", "custom message")
        self.assertEqual(saved["history"][0]["message"], "custom message")
        self.assertEqual(self.history.sequence_read()["head"], initial["head"])
        self.assertEqual(self.history.sequence_read("feature")["head"], saved["head"])
        with self.assertRaises(StaleHead):
            self.history.sequence_save([], initial["head"], "feature")
        with self.assertRaises(InvalidInput):
            self.history.sequence_read("--bad")

    def test_rollback_preserves_other_tree_entries_and_detects_race(self):
        initial = self.history.save("note", None, "initial")
        edited = self.history.sequence_save(self.change, initial["head"])
        blob = self.history._git("hash-object", "-w", "--stdin", data=b"other data").stdout.decode().strip()
        with_other = self.history._commit_file(edited["head"], "other.txt", blob, "other")
        restored = self.history.sequence_rollback(initial["head"], with_other["head"])
        self.assertEqual(self.history._git("show", restored["head"] + ":other.txt").stdout, b"other data")
        self.assertEqual(self.history.read()["content"], "note")
        real_commit = self.history._commit_file

        def race(head, name, blob, message, branch):
            GitHistory(self.history.path).save("concurrent note", head, "concurrent", branch)
            return real_commit(head, name, blob, message, branch)

        with patch.object(self.history, "_commit_file", side_effect=race), self.assertRaises(StaleHead):
            self.history.sequence_rollback(edited["head"], restored["head"])
        self.assertEqual(self.history.read()["content"], "concurrent note")
        self.assertEqual(self.history.sequence_read()["substitutions"], [])


class SequenceHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = server.NOTES
        server.NOTES = GitHistory(Path(self.temp.name) / "notes.git")
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        server.NOTES = self.old
        self.temp.cleanup()

    def request(self, method, path, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.http.server_port)
        connection.request(method, path, None if body is None else json.dumps(body),
                           {"Content-Type": "application/json"})
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_http_round_trip_and_rejections(self):
        status, initial = self.request("GET", "/api/sequence")
        self.assertEqual(status, 200)
        self.assertIsNone(initial["head"])
        payload = {"expected_head": None, "substitutions": [
            {"position": 7, "reference": "E", "alternate": "V"}]}
        status, result = self.request("POST", "/api/sequence", payload)
        self.assertEqual(status, 200)
        self.assertEqual(result["sequence"][6], "V")
        self.assertEqual(self.request("POST", "/api/sequence", payload)[0], 409)
        self.assertEqual(self.request("POST", "/api/sequence", {**payload, "patient": "x"})[0], 400)
        status, diff = self.request("GET", "/api/sequence/diff?commit=" + result["head"])
        self.assertEqual(status, 200)
        self.assertIn("sequence.json", diff["diff"])
        self.assertEqual(self.request("GET", "/api/sequence/diff?commit=main")[0], 400)

    def test_branch_and_rollback_http(self):
        initial = server.NOTES.save("note", None, "initial")
        self.assertEqual(self.request("POST", "/api/branches", {
            "name": "test", "from_branch": "main", "expected_head": initial["head"]})[0], 200)
        status, saved = self.request("POST", "/api/sequence", {
            "branch": "test", "expected_head": initial["head"], "message": "experiment",
            "substitutions": [{"position": 7, "reference": "E", "alternate": "V"}]})
        self.assertEqual(status, 200)
        self.assertEqual(saved["history"][0]["message"], "experiment")
        self.assertEqual(self.request("GET", "/api/sequence?branch=test")[1]["head"], saved["head"])
        self.assertEqual(self.request("GET", "/api/sequence")[1]["head"], initial["head"])
        self.assertEqual(self.request("GET", "/api/branches")[0], 200)
        payload = {"branch": "test", "target": initial["head"], "expected_head": saved["head"]}
        status, restored = self.request("POST", "/api/sequence/rollback", payload)
        self.assertEqual(status, 200)
        self.assertEqual(restored["substitutions"], [])
        self.assertEqual(self.request("POST", "/api/sequence/rollback", payload)[0], 409)
        self.assertEqual(self.request("GET", "/api/sequence?branch=bad..name")[0], 400)

    def test_compare_http_contract_and_validation(self):
        first = server.NOTES.save("secret\n", None, "initial")
        second = server.NOTES.sequence_save(
            [{"position": 7, "reference": "E", "alternate": "V"}], first["head"])
        path = "/api/compare?from=" + first["head"] + "&to=" + second["head"]
        status, result = self.request("GET", path)
        self.assertEqual(status, 200)
        self.assertEqual(result["sequence"]["changes"], [{"position": 7, "old": "E", "new": "V"}])
        self.assertIn("-MVHLTPEE", result["sequence"]["raw_diff"])
        self.assertIn("+MVHLTPVE", result["sequence"]["raw_diff"])
        self.assertEqual(result["from"]["note"], "secret\n")
        self.assertNotIn("secret", json.dumps(result["from"]["sequence"]))
        for query in ("", "from=main&to=" + second["head"], "from=&to=" + second["head"],
                      "from=" + first["head"] + "&to=" + second["head"] + "&to=" + second["head"],
                      "from=" + first["head"] + "&to=" + second["head"] + "&extra=x"):
            with self.subTest(query=query):
                self.assertEqual(self.request("GET", "/api/compare?" + query)[0], 400)

    def test_first_sequence_reference_comparison_and_explanation_both_directions(self):
        status, saved = self.request("POST", "/api/sequence", {
            "expected_head": None,
            "substitutions": [{"position": 7, "reference": "E", "alternate": "V"}]})
        self.assertEqual(status, 200)
        before = server.NOTES.read()
        self.assertEqual(len(before["history"]), 1)
        self.assertEqual(server.NOTES._git("rev-list", "--count", "main").stdout.strip(), b"1")
        sections = json.dumps({"observations": "A residue differs.",
                               "hypotheses": "Uncertain.", "caveats": "Not evidence."})
        for source, target, old, new in (
                ("reference", saved["head"], "E", "V"),
                (saved["head"], "reference", "V", "E")):
            status, result = self.request("GET", f"/api/compare?from={source}&to={target}")
            self.assertEqual(status, 200)
            self.assertEqual(result["from"]["commit"], source)
            self.assertEqual(result["to"]["commit"], target)
            self.assertEqual(result["sequence"]["changes"], [{"position": 7, "old": old, "new": new}])
            self.assertIn("-MVHLTP" + old, result["sequence"]["raw_diff"])
            self.assertIn("+MVHLTP" + new, result["sequence"]["raw_diff"])
            baseline = result["from"] if source == "reference" else result["to"]
            self.assertEqual(baseline["kind"], "reference")
            self.assertIsNone(baseline["note"])
            self.assertEqual(result["sequence"]["diff"], "")
            self.assertEqual(result["notes"]["diff"], "")
            self.assertIn("not a Git commit", result["patch_semantics"])
            with patch.dict("os.environ", {"GEMINI_API_KEY": "test-only"}), \
                 patch.object(server.agent_explain, "_gemini", return_value=sections) as provider:
                status, explanation = self.request("POST", "/api/agent/explain", {
                    "from": source, "to": target, "question": "What changed?", "consent": True})
                self.assertEqual(status, 200)
                self.assertEqual(explanation["from_commit"], source)
                self.assertEqual(explanation["to_commit"], target)
                self.assertEqual(provider.call_args.args[2], [
                    {"position": 7, "old": old, "new": new, "reference": "E"}])
        self.assertEqual(server.NOTES.read(), before)
