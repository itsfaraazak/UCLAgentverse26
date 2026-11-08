import json
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import server


TEXT = "Review evidence and human oversight for synthetic gene editing research"


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "store.sqlite3"

    def store(self, *args, **kwargs):
        store = server.Store(*args, db_path=self.path, **kwargs)
        self.addCleanup(store.db.close)
        return store

    def test_restart_preserves_workspace_and_review(self):
        store = self.store()
        state = store.run(TEXT, 0)
        oid = state["repository"]["branches"]["investigator-1"]
        state = store.repository_action("comment", {
            "commit": oid, "field": "summary", "text": "Review this"
        }, state["version"])
        state = store.review("request_changes", state["version"], state["repository"]["branches"]["main"])
        self.assertEqual(self.store().snapshot(), state)

    def test_legacy_conflicting_reviews_are_discarded(self):
        store = self.store()
        state = store.run(TEXT, 0)
        state["review"] = {"decision": "request_changes", "version": state["version"]}
        state["repository"]["review"] = {"decision": "approve", "commit": state["repository"]["branches"]["main"]}
        with store.db:
            store.db.execute("UPDATE store SET state = ? WHERE id = 1", (json.dumps(state),))
        loaded = self.store().snapshot()
        self.assertIsNone(loaded["review"])
        self.assertNotIn("review", loaded["repository"])
        loaded = store.review("request_changes", loaded["version"], loaded["repository"]["branches"]["main"])
        self.assertEqual(self.store().snapshot()["review"], loaded["review"])

    def test_failed_run_and_invalidated_approval_survive_restart(self):
        store = self.store()
        state = store.run(TEXT, 0)
        store.review("request_changes", state["version"], state["repository"]["branches"]["main"])
        failing = self.store("secret", lambda *args: "invalid")
        with self.assertRaises(server.APIError):
            failing.run(TEXT, state["draft_revision"])
        state = self.store().snapshot()
        self.assertIsNone(state["review"])
        self.assertEqual(state["agents"], [])
        self.assertNotIn("repository", state)
        self.assertIn("error", state)
        self.assertEqual(state["history"][-1]["event"], "run_failed")

    def test_write_failure_rolls_back_memory_and_disk(self):
        store = self.store()
        before = store.snapshot()
        store.db.execute("""CREATE TRIGGER fail_update BEFORE UPDATE ON store
                            BEGIN SELECT RAISE(ABORT, 'injected'); END""")
        store.db.commit()
        with self.assertRaises(server.APIError) as error:
            store.draft(TEXT, 0)
        self.assertEqual(error.exception.status, 503)
        self.assertEqual(store.snapshot(), before)
        self.assertEqual(self.store().snapshot(), before)

    def test_concurrent_instances_reject_stale_revision(self):
        stores = [self.store(), self.store()]
        barrier = threading.Barrier(2)
        outcomes = []

        def update(store, text):
            barrier.wait()
            try:
                store.draft(text, 0)
                outcomes.append(200)
            except server.APIError as exc:
                outcomes.append(exc.status)

        threads = [threading.Thread(target=update, args=(stores[0], TEXT)),
                   threading.Thread(target=update, args=(stores[1], "Review governance"))]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(5)
            self.assertFalse(thread.is_alive())
        self.assertCountEqual(outcomes, [200, 409])
        self.assertEqual(stores[0].snapshot(), stores[1].snapshot())
        self.assertEqual(stores[0].snapshot()["draft_revision"], 1)

    def test_overlapping_runs_execute_only_one_pipeline(self):
        first, second = self.store(), self.store()
        started, release = threading.Event(), threading.Event()
        calls, outcomes = [], []
        pipeline = server.run_pipeline

        def blocking_pipeline(*args):
            calls.append(1)
            started.set()
            if len(calls) == 1:
                release.wait(5)
            return pipeline(*args)

        def run(store):
            try:
                store.run("Compare base editing evidence and uncertainty for synthetic gene editing research", 0)
                outcomes.append(200)
            except server.APIError as exc:
                outcomes.append(exc.status)

        with patch("backend.server.run_pipeline", side_effect=blocking_pipeline):
            thread = threading.Thread(target=run, args=(first,))
            thread.start()
            try:
                self.assertTrue(started.wait(2))
                run(second)
            finally:
                release.set()
                thread.join(5)
            self.assertFalse(thread.is_alive())
        self.assertCountEqual(outcomes, [200, 409])
        self.assertEqual(len(calls), 1)

    def test_run_lock_released_after_process_exit(self):
        store = self.store()
        code = """
import sys, time
from backend.server import Store
store = Store(db_path=sys.argv[1])
with store._run_guard():
    print("locked", flush=True)
    time.sleep(30)
"""
        process = subprocess.Popen([sys.executable, "-u", "-c", code, str(self.path)],
                                   stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(process.stdout.readline().strip(), "locked")
            with self.assertRaises(server.APIError) as error:
                store.run(TEXT, 0)
            self.assertEqual(error.exception.status, 409)
        finally:
            process.kill()
            process.wait(timeout=5)
            process.stdout.close()
        self.assertEqual(store.run(TEXT, 0)["draft"], TEXT)

    def test_run_lock_released_after_unexpected_failure(self):
        store = self.store()
        with patch("backend.server.run_pipeline", side_effect=RuntimeError("failure")):
            with self.assertRaises(RuntimeError):
                store.run(TEXT, 0)
        state = store.snapshot()
        self.assertEqual(store.run(TEXT, state["draft_revision"])["draft"], TEXT)

    def test_cannot_open_invalid_database(self):
        self.path.write_text("not a database")
        with self.assertRaises(sqlite3.DatabaseError):
            server.Store(db_path=self.path)

    def test_presence_shared_expiring_and_separate_from_workspace(self):
        first, second = self.store(), self.store()
        before = first.snapshot()
        with patch("backend.server.time.time", return_value=100):
            self.assertEqual(first.heartbeat("a" * 32)["active"], 1)
            self.assertEqual(second.heartbeat("b" * 32)["active"], 2)
            self.assertEqual(first.heartbeat("a" * 32)["active"], 2)
        with patch("backend.server.time.time", return_value=116):
            self.assertEqual(second.heartbeat("b" * 32)["active"], 1)
        self.assertEqual(first.snapshot(), before)
        with self.assertRaises(server.APIError):
            first.heartbeat("not-an-id")

    def test_conflict_resolution_is_also_revision_checked(self):
        first, second = self.store(), self.store()
        first.draft(TEXT, 0)
        seen = second.snapshot()
        first.draft("Review governance", seen["draft_revision"])
        with self.assertRaises(server.APIError) as error:
            second.draft("Review evidence", seen["draft_revision"])
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(second.snapshot()["draft"], "Review governance")


if __name__ == "__main__":
    unittest.main()
