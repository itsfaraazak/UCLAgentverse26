import os
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.git_history import GitHistory, InvalidInput, StaleHead, StorageError


class GitHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "history.git"
        self.history = GitHistory(self.path)

    def git(self, *args):
        return subprocess.check_output(["git", "--git-dir", str(self.path), *args]).decode()

    def test_real_git_history_diff_and_restart(self):
        self.assertEqual(self.history.read(), {"head": None, "content": "", "history": []})
        first = self.history.save("HBB variant: uncertain\n", None, "Initial note")
        second = self.history.save("HBB variant: uncertain\nReview evidence.\n", first["head"], "Add review")
        self.assertEqual(GitHistory(self.path).read(), second)
        self.assertEqual(self.git("rev-parse", "refs/heads/main").strip(), second["head"])
        self.assertEqual(self.git("show", second["head"] + ":note.md"), second["content"])
        self.assertEqual(self.git("rev-parse", second["head"] + "^").strip(), first["head"])
        self.assertEqual([i["message"] for i in second["history"]], ["Add review", "Initial note"])
        self.assertIn("+Review evidence.", self.history.diff(second["head"]))
        self.assertIn("+HBB variant: uncertain", self.history.diff(first["head"]))

    def test_stale_writes_and_invalid_input_do_not_change_head(self):
        first = self.history.save("one", None, "first")
        second = self.history.save("two", first["head"], "second")
        with self.assertRaises(StaleHead):
            self.history.save("lost", first["head"], "stale")
        for content, head, message in [("two", second["head"], "same"),
                                       ("x" * 65537, second["head"], "large"),
                                       ("ok", second["head"], "bad\nmessage"),
                                       ("ok", "main", "bad revision"),
                                       ("\ud800", second["head"], "invalid")]:
            with self.subTest(message=message), self.assertRaises(InvalidInput):
                self.history.save(content, head, message)
        with self.assertRaises(InvalidInput):
            self.history.diff("main")
        self.assertEqual(self.history.read(), second)

    def test_existing_files_and_repositories_are_never_modified(self):
        self.path.mkdir()
        (self.path / "valuable").write_text("keep")
        with self.assertRaises(StorageError):
            self.history.save("note", None, "first")
        self.assertEqual((self.path / "valuable").read_text(), "keep")
        self.assertEqual(sorted(p.name for p in self.path.iterdir()), ["valuable"])

    def test_symlink_path_rejected(self):
        target = Path(self.temp.name) / "other"
        target.mkdir()
        self.path.symlink_to(target, target_is_directory=True)
        with self.assertRaises(StorageError):
            self.history.save("note", None, "first")
        self.assertEqual(list(target.iterdir()), [])

    def test_concurrent_writers_do_not_overwrite_each_other(self):
        first = self.history.save("base", None, "initial")
        barrier = threading.Barrier(2)
        outcomes = []

        def write(text):
            barrier.wait()
            try:
                outcomes.append(GitHistory(self.path).save(text, first["head"], text)["content"])
            except StaleHead:
                outcomes.append("stale")

        threads = [threading.Thread(target=write, args=(text,)) for text in ("one", "two")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
            self.assertFalse(thread.is_alive())
        self.assertEqual(len(outcomes), 2)
        self.assertEqual(outcomes.count("stale"), 1)
        self.assertIn(self.history.read()["content"], outcomes)
        self.assertEqual(len(self.history.read()["history"]), 2)

    def test_git_environment_config_and_hooks_are_not_used(self):
        first = self.history.save("one", None, "initial")
        sentinel = Path(self.temp.name) / "hook-ran"
        hook = self.path / "hooks" / "reference-transaction"
        hook.parent.mkdir(exist_ok=True)
        hook.write_text("#!/bin/sh\ntouch " + str(sentinel) + "\nexit 1\n")
        hook.chmod(0o755)
        config = Path(self.temp.name) / "global-config"
        config.write_text("[commit]\n\tgpgSign = true\n[core]\n\thooksPath = /nonexistent\n")
        with patch.dict(os.environ, {"GIT_DIR": "/nonexistent", "GIT_CONFIG_GLOBAL": str(config),
                                     "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "commit.gpgSign",
                                     "GIT_CONFIG_VALUE_0": "true"}):
            second = self.history.save("two", first["head"], "second")
        self.assertEqual(second["content"], "two")
        self.assertFalse(sentinel.exists())

    def test_corrupt_ref_fails_closed(self):
        self.history.save("one", None, "initial")
        (self.path / "refs" / "heads" / "main").write_text("not-a-ref\n")
        with self.assertRaises(StorageError):
            self.history.read()


if __name__ == "__main__":
    unittest.main()
