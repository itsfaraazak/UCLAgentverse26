import http.client
import io
import json
import tempfile
import threading
import time
import types
import unittest
import urllib.error
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from backend import hbb_sequence, server, structure_prediction as prediction
from backend.git_history import GitHistory


SEQUENCE = hbb_sequence.REFERENCE["sequence"]
NAMES = {letter: name for name, letter in prediction._RESIDUES.items()}


def pdb_for(sequence):
    return "".join(
        f"ATOM  {(i - 1) * 4 + j:5d} {atom:4s} {NAMES[aa]} A{i:4d}    "
        f"{i * 3.8:8.3f}{float(j):8.3f}{3.0:8.3f}{1.0:6.2f}{90.0:6.2f}           {atom.strip()[0]:>2s}\n"
        for i, aa in enumerate(sequence, 1)
        for j, atom in enumerate((" N  ", " CA ", " C  ", " O  "), 1)) + "TER\nEND\n"


class Response(io.BytesIO):
    status = 200


class PredictionTests(unittest.TestCase):
    def test_modal_concurrent_distinct_and_duplicate(self):
        entered = [threading.Event() for _ in range(3)]
        release = threading.Event()
        sequences = [SEQUENCE, "A" + SEQUENCE[1:], "C" + SEQUENCE[1:]]
        calls = []
        results = []

        def provider(sequence):
            calls.append(sequence)
            entered[sequences.index(sequence)].set()
            release.wait(2)
            return sequence

        def call(sequence):
            try:
                results.append(prediction.predict(sequence))
            except prediction.PredictionError as exc:
                results.append(exc.status)

        scheduler = prediction._ModalScheduler()
        with patch.dict("os.environ", {"EDITVERSE_FOLD_PROVIDER": "modal"}), \
                patch.object(prediction, "_modal_scheduler", scheduler), \
                patch.object(prediction, "_modal_request", side_effect=provider):
            threads = [threading.Thread(target=call, args=(s,)) for s in sequences + [sequences[0]]]
            try:
                threads[0].start()
                self.assertTrue(entered[0].wait(1))
                threads[1].start()
                self.assertTrue(entered[1].wait(1))
                threads[2].start()
                threads[3].start()
                with scheduler.condition:
                    self.assertTrue(scheduler.condition.wait_for(
                        lambda: scheduler.callers == 4, timeout=1))
                    self.assertEqual(len(scheduler.queue), 1)
                    self.assertEqual(scheduler.active, 2)
            finally:
                release.set()
                for thread in threads:
                    if thread.ident is not None:
                        thread.join(3)
            self.assertCountEqual(results, sequences + [sequences[0]])
            self.assertCountEqual(calls, sequences)

    def test_modal_queue_bound_timeout_and_no_late_submission(self):
        scheduler = prediction._ModalScheduler()
        entered, release = threading.Event(), threading.Event()
        calls = []
        results = []
        other = "A" + SEQUENCE[1:]

        def provider(sequence):
            calls.append(sequence)
            entered.set()
            release.wait(2)
            return sequence

        def call(sequence):
            try:
                results.append(prediction.predict(sequence))
            except prediction.PredictionError as exc:
                results.append(exc.status)

        with patch.dict("os.environ", {"EDITVERSE_FOLD_PROVIDER": "modal"}), \
                patch.object(prediction, "_modal_scheduler", scheduler), \
                patch.object(prediction, "_modal_request", side_effect=provider), \
                patch.object(prediction, "MAX_IN_FLIGHT", 1), \
                patch.object(prediction, "MODAL_MAX_CALLERS", 2), \
                patch.object(prediction, "MODAL_QUEUE_TIMEOUT_SECONDS", 0.2), \
                patch.object(prediction, "MODAL_TIMEOUT_SECONDS", 0.2):
            first = threading.Thread(target=call, args=(SEQUENCE,))
            second = threading.Thread(target=call, args=(other,))
            try:
                first.start()
                self.assertTrue(entered.wait(1))
                second.start()
                with scheduler.condition:
                    self.assertTrue(scheduler.condition.wait_for(
                        lambda: scheduler.callers == 2, timeout=1))
                with self.assertRaises(prediction.PredictionError) as exc:
                    prediction.predict(SEQUENCE)
                self.assertEqual(exc.exception.status, 429)
                first.join(1)
                second.join(1)
                self.assertCountEqual(results, [504, 504])
                with scheduler.condition:
                    self.assertEqual(len(scheduler.queue), 0)
                    self.assertEqual(scheduler.active, 1)
            finally:
                release.set()
                first.join(2)
                second.join(2)
                with scheduler.condition:
                    self.assertTrue(scheduler.condition.wait_for(
                        lambda: scheduler.active == 0, timeout=2))
            self.assertEqual(calls, [SEQUENCE])
            self.assertEqual(scheduler.jobs, {})

    def test_modal_execution_deadline_starts_after_queue_admission(self):
        scheduler = prediction._ModalScheduler()
        clock = [0.0]
        sequences = [SEQUENCE, "A" + SEQUENCE[1:]]
        entered = [threading.Event(), threading.Event()]
        release = [threading.Event(), threading.Event()]
        results = []

        def provider(sequence):
            index = sequences.index(sequence)
            entered[index].set()
            release[index].wait(2)
            return sequence

        def call(sequence):
            try:
                results.append(prediction.predict(sequence))
            except prediction.PredictionError as exc:
                results.append(exc.status)

        with patch.dict("os.environ", {"EDITVERSE_FOLD_PROVIDER": "modal"}), \
                patch.object(prediction, "_modal_scheduler", scheduler), \
                patch.object(prediction, "_modal_request", side_effect=provider), \
                patch.object(prediction, "MAX_IN_FLIGHT", 1), \
                patch.object(prediction, "MODAL_QUEUE_TIMEOUT_SECONDS", 100), \
                patch.object(prediction, "MODAL_TIMEOUT_SECONDS", 100), \
                patch.object(prediction.time, "monotonic", side_effect=lambda: clock[0]):
            threads = [threading.Thread(target=call, args=(s,)) for s in sequences]
            try:
                threads[0].start()
                self.assertTrue(entered[0].wait(1))
                threads[1].start()
                with scheduler.condition:
                    self.assertTrue(scheduler.condition.wait_for(
                        lambda: len(scheduler.queue) == 1, timeout=1))
                    clock[0] = 90
                release[0].set()
                self.assertTrue(entered[1].wait(1))
                threads[0].join(1)
                self.assertFalse(threads[0].is_alive())
                with scheduler.condition:
                    clock[0] = 110
                    scheduler.condition.notify_all()
                # Completion after the original caller deadline must still succeed.
                release[1].set()
            finally:
                for event in release:
                    event.set()
                for thread in threads:
                    if thread.ident is not None:
                        thread.join(2)
            self.assertCountEqual(results, sequences)

    def test_modal_completed_job_remains_shareable_until_last_waiter_leaves(self):
        scheduler = prediction._ModalScheduler()
        key = (SEQUENCE, "facebook/esmfold_v1", prediction.MODAL_MODEL_REVISION)
        job = prediction._ModalJob(key)
        job.started = True
        job.started_at = time.monotonic()
        job.deadline = job.started_at + prediction.MODAL_TIMEOUT_SECONDS
        job.callers = 1  # An existing waiter has not yet consumed the result.
        scheduler.callers = 1
        scheduler.active = 1
        scheduler.jobs[key] = job
        with patch.dict("os.environ", {"EDITVERSE_FOLD_PROVIDER": "modal"}), \
                patch.object(prediction, "_modal_scheduler", scheduler), \
                patch.object(prediction, "_modal_request", return_value="result") as remote:
            scheduler._run(job)
            self.assertIs(scheduler.jobs.get(key), job)
            self.assertEqual(prediction.predict(SEQUENCE), "result")
            self.assertIs(scheduler.jobs.get(key), job)
            remote.assert_called_once_with(SEQUENCE)

    def test_modal_failure_is_shared_and_retry_cleans_up(self):
        scheduler = prediction._ModalScheduler()
        entered, release = threading.Event(), threading.Event()
        results = []

        def provider(sequence):
            entered.set()
            release.wait(2)
            raise RuntimeError("private upstream details")

        def call():
            try:
                prediction.predict(SEQUENCE)
            except prediction.PredictionError as exc:
                results.append((exc.status, str(exc)))

        with patch.dict("os.environ", {"EDITVERSE_FOLD_PROVIDER": "modal"}), \
                patch.object(prediction, "_modal_scheduler", scheduler), \
                patch.object(prediction, "_modal_request", side_effect=provider) as remote:
            first, second = threading.Thread(target=call), threading.Thread(target=call)
            try:
                first.start()
                self.assertTrue(entered.wait(1))
                second.start()
                with scheduler.condition:
                    self.assertTrue(scheduler.condition.wait_for(
                        lambda: scheduler.callers == 2, timeout=1))
            finally:
                release.set()
                first.join(2)
                second.join(2)
            self.assertEqual(results, [(502, "Prediction provider is unavailable.")] * 2)
            self.assertEqual(remote.call_count, 1)
            self.assertEqual(scheduler.jobs, {})
            call()
            self.assertEqual(remote.call_count, 2)
            self.assertEqual(scheduler.jobs, {})

    def test_modal_fifo_distinct_jobs(self):
        scheduler = prediction._ModalScheduler()
        sequences = [SEQUENCE, "A" + SEQUENCE[1:], "C" + SEQUENCE[1:]]
        entered = [threading.Event() for _ in sequences]
        release = [threading.Event() for _ in sequences]
        calls = []

        def provider(sequence):
            index = sequences.index(sequence)
            calls.append(sequence)
            entered[index].set()
            release[index].wait(2)
            return sequence

        with patch.dict("os.environ", {"EDITVERSE_FOLD_PROVIDER": "modal"}), \
                patch.object(prediction, "_modal_scheduler", scheduler), \
                patch.object(prediction, "_modal_request", side_effect=provider), \
                patch.object(prediction, "MAX_IN_FLIGHT", 1):
            threads = [threading.Thread(target=prediction.predict, args=(s,)) for s in sequences]
            try:
                threads[0].start()
                self.assertTrue(entered[0].wait(1))
                for index in (1, 2):
                    threads[index].start()
                    with scheduler.condition:
                        self.assertTrue(scheduler.condition.wait_for(
                            lambda: len(scheduler.queue) == index, timeout=1))
                release[0].set()
                self.assertTrue(entered[1].wait(1))
                self.assertFalse(entered[2].is_set())
                release[1].set()
                self.assertTrue(entered[2].wait(1))
            finally:
                for event in release:
                    event.set()
                for thread in threads:
                    if thread.ident is not None:
                        thread.join(2)
            self.assertEqual(calls, sequences)
            self.assertEqual(scheduler.jobs, {})

    def test_modal_thread_start_failure_releases_admission(self):
        scheduler = prediction._ModalScheduler()
        with patch.dict("os.environ", {"EDITVERSE_FOLD_PROVIDER": "modal"}), \
                patch.object(prediction, "_modal_scheduler", scheduler), \
                patch.object(prediction.threading.Thread, "start", side_effect=RuntimeError):
            with self.assertRaises(prediction.PredictionError) as exc:
                prediction.predict(SEQUENCE)
            self.assertEqual(exc.exception.status, 502)
            self.assertEqual((scheduler.active, scheduler.callers), (0, 0))
            self.assertEqual(scheduler.jobs, {})
            self.assertEqual(len(scheduler.queue), 0)

    def test_interrupted_modal_waiter_cannot_submit_later(self):
        scheduler = prediction._ModalScheduler()
        scheduler.active = 1
        with patch.dict("os.environ", {"EDITVERSE_FOLD_PROVIDER": "modal"}), \
                patch.object(prediction, "_modal_scheduler", scheduler), \
                patch.object(prediction, "MAX_IN_FLIGHT", 1), \
                patch.object(prediction, "_modal_request") as remote, \
                patch.object(scheduler.condition, "wait", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                prediction.predict(SEQUENCE)
            self.assertEqual(scheduler.callers, 0)
            self.assertEqual(scheduler.jobs, {})
            self.assertEqual(len(scheduler.queue), 0)
            scheduler.active = 0
            remote.assert_not_called()

    def test_modal_adapter_validates_output_and_does_not_put_sequence_in_arguments(self):
        result = {"pdb": pdb_for(SEQUENCE), "plddt_ca": [80.0] * 147,
                  "provenance": {"model": "facebook/esmfold_v1",
                                 "revision": prediction.MODAL_MODEL_REVISION}}
        completed = types.SimpleNamespace(returncode=0, stdout=json.dumps(result))
        with patch.dict("os.environ", {"GEMINI_API_KEY": "do-not-forward"}), \
                patch.object(prediction.subprocess, "run", return_value=completed) as run:
            self.assertEqual(prediction._modal_request(SEQUENCE), result["pdb"])
            self.assertEqual(run.call_args.kwargs["input"], SEQUENCE)
            self.assertNotIn(SEQUENCE, " ".join(run.call_args.args[0]))
            self.assertNotIn("GEMINI_API_KEY", run.call_args.kwargs["env"])
        result["plddt_ca"][0] = 101
        completed.stdout = json.dumps(result)
        with patch.object(prediction.subprocess, "run", return_value=completed):
            with self.assertRaises(prediction.PredictionError):
                prediction._modal_request(SEQUENCE)

    def test_request_sends_only_sequence_and_validates_response(self):
        class Opener:
            def open(self, request, timeout):
                self_test.assertEqual(request.full_url, prediction.URL)
                self_test.assertEqual(request.data, SEQUENCE.encode())
                self_test.assertEqual(request.get_method(), "POST")
                self_test.assertEqual(timeout, prediction.TIMEOUT_SECONDS)
                return Response(pdb_for(SEQUENCE).encode())
        self_test = self
        with patch.object(prediction.urllib.request, "build_opener", return_value=Opener()):
            self.assertEqual(prediction.predict(SEQUENCE), pdb_for(SEQUENCE))

    def test_untrusted_output_rejected(self):
        pdb = pdb_for(SEQUENCE)
        lines = pdb.splitlines(keepends=True)
        bad = [
            pdb_for("A" + SEQUENCE[1:]),
            "".join(line[:22] + f"{int(line[22:26]) + 1:4d}" + line[26:]
                    if line.startswith("ATOM") else line for line in lines),
            "".join(line[:26] + "A" + line[27:] if line.startswith("ATOM") else line
                    for line in lines),
            "".join(lines[:-6]) + "TER\nEND\n",
            "".join(lines[:4] + [lines[4][:21] + "B" + lines[4][22:]] + lines[5:]),
            "".join([lines[0][:30] + "     nan" + lines[0][38:]] + lines[1:]),
            "".join([lines[0], lines[0]] + lines[1:]),
            "".join(lines[:3] + lines[4:]),
            "".join(lines[:5] + [lines[5][:30] + lines[1][30:54] + lines[5][54:]] + lines[6:]),
            pdb + "HETATM" + lines[0][6:],
            "MODEL        1\n" + pdb + "MODEL        2\n",
            "ATOM   broken\n" + pdb,
        ]
        for value in bad:
            with self.subTest(value=value[:60]), self.assertRaises(prediction.PredictionError):
                prediction.validate_pdb(value.encode(), SEQUENCE)
        with self.assertRaises(prediction.PredictionError):
            prediction.validate_pdb(b"\xff", SEQUENCE)

    def test_failures_and_size_limit(self):
        class Opener:
            def __init__(self, result):
                self.result = result

            def open(self, request, timeout):
                if isinstance(self.result, Exception):
                    raise self.result
                return Response(self.result)

        cases = [
            (urllib.error.HTTPError(prediction.URL, 302, "", {}, None), 502),
            (urllib.error.HTTPError(prediction.URL, 429, "", {}, None), 503),
            (urllib.error.HTTPError(prediction.URL, 408, "", {}, None), 504),
            (urllib.error.HTTPError(prediction.URL, 504, "", {}, None), 504),
            (urllib.error.HTTPError(prediction.URL, 500, "", {}, None), 502),
            (urllib.error.URLError(TimeoutError()), 504),
            (urllib.error.URLError("offline"), 502),
            (b"x" * (prediction.MAX_RESPONSE_BYTES + 1), 502),
            (b"not a pdb", 502),
        ]
        for response, status in cases:
            with self.subTest(status=status), patch.object(
                    prediction.urllib.request, "build_opener", return_value=Opener(response)):
                with self.assertRaises(prediction.PredictionError) as exc:
                    prediction.predict(SEQUENCE)
                self.assertEqual(exc.exception.status, status)
        handler = prediction._NoRedirect()
        self.assertIsNone(handler.redirect_request(None, None, 307, "", {}, "https://evil.example/"))

    def test_real_opener_disables_proxies_and_redirects(self):
        captured = {}
        original = prediction.urllib.request.build_opener

        def build(*handlers):
            opener = original(*handlers)
            captured["opener"] = opener
            return opener

        def fail(request, timeout):
            raise urllib.error.URLError("offline")

        with patch.object(prediction.urllib.request, "build_opener", side_effect=build), \
                patch.object(prediction.urllib.request.OpenerDirector, "open", side_effect=fail):
            with self.assertRaises(prediction.PredictionError):
                prediction.predict(SEQUENCE)
        handlers = captured["opener"].handlers
        self.assertTrue(any(isinstance(h, prediction._NoRedirect) for h in handlers))
        self.assertFalse(any(type(h) is prediction.urllib.request.HTTPRedirectHandler for h in handlers))
        self.assertFalse(any(isinstance(h, prediction.urllib.request.ProxyHandler) for h in handlers))

    def test_capacity_and_overall_deadline(self):
        entered, release = threading.Event(), threading.Event()
        def blocked(sequence):
            entered.set()
            release.wait(2)
            return pdb_for(sequence)
        slots = threading.BoundedSemaphore(1)
        with patch.object(prediction, "_slots", slots), patch.object(prediction, "_request", side_effect=blocked), \
                patch.object(prediction, "TIMEOUT_SECONDS", 0.05):
            try:
                with self.assertRaises(prediction.PredictionError) as exc:
                    prediction.predict(SEQUENCE)
                self.assertTrue(entered.is_set())
                self.assertEqual(exc.exception.status, 504)
                with self.assertRaises(prediction.PredictionError) as exc:
                    prediction.predict(SEQUENCE)
                self.assertEqual(exc.exception.status, 429)
            finally:
                release.set()
                for _ in range(100):
                    if slots.acquire(blocking=False):
                        slots.release()
                        break
                    time.sleep(0.01)
                else:
                    self.fail("worker did not release slot")


class PredictionHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_notes = server.NOTES
        server.NOTES = GitHistory(Path(self.temp.name) / "notes.git")
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        server.NOTES = self.old_notes
        self.temp.cleanup()

    def post(self, body, consent=True):
        conn = http.client.HTTPConnection("127.0.0.1", self.http.server_port, timeout=5)
        try:
            if consent:
                body = {"consent": True, **body}
            conn.request("POST", "/api/structure/predict", json.dumps(body),
                         {"Content-Type": "application/json"})
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def test_automatic_mode_requires_explicit_modal_configuration(self):
        for environment, expected in (
            ({"EDITVERSE_FOLD_PROVIDER": "atlas", "EDITVERSE_FOLD_AUTOMATIC": "1"}, False),
            ({"EDITVERSE_FOLD_PROVIDER": "modal", "EDITVERSE_FOLD_AUTOMATIC": "0"}, False),
            ({"EDITVERSE_FOLD_PROVIDER": "modal", "EDITVERSE_FOLD_AUTOMATIC": "1"}, True),
        ):
            with self.subTest(environment=environment), patch.dict("os.environ", environment):
                conn = http.client.HTTPConnection("127.0.0.1", self.http.server_port, timeout=5)
                try:
                    conn.request("GET", "/api/structure/provider")
                    response = conn.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(json.loads(response.read())["automatic"], expected)
                finally:
                    conn.close()

    def test_explicit_consent_required_without_disclosure(self):
        first = server.NOTES.save("private note", None, "initial")
        with patch.object(prediction, "_request") as remote:
            for extra in ({}, {"consent": False}, {"consent": None},
                          {"consent": 1}, {"consent": "true"}):
                with self.subTest(extra=extra):
                    status, result = self.post(
                        {"branch": "main", "expected_head": first["head"], **extra},
                        consent=False)
                    self.assertEqual(status, 400)
                    self.assertEqual(set(result), {"error"})
                    self.assertNotIn(SEQUENCE, json.dumps(result))
                    self.assertNotIn("private note", json.dumps(result))
            remote.assert_not_called()

    def test_empty_branch_predicts_the_reference_sequence(self):
        with patch.object(prediction, "_request", return_value=pdb_for(SEQUENCE)) as remote:
            status, result = self.post({"branch": "main", "expected_head": None})
        self.assertEqual(status, 200)
        self.assertEqual(result["head"], None)
        self.assertEqual(result["commit"], "reference")
        self.assertEqual(result["sequence"], SEQUENCE)
        self.assertEqual(result["model"], "ESMFold")
        remote.assert_called_once_with(SEQUENCE)
        self.assertIsNone(server.NOTES.sequence_read()["head"])

    def test_stale_missing_invalid_and_snapshot_race(self):
        with patch.object(prediction, "_request") as remote:
            self.assertEqual(self.post({"branch": "main", "expected_head": "a" * 40})[0], 400)
            first = server.NOTES.save("private note", None, "initial")
            self.assertEqual(self.post({"branch": "main", "expected_head": None})[0], 400)
            self.assertEqual(self.post({"branch": "main", "expected_head": "a" * 40})[0], 409)
            self.assertEqual(self.post({"branch": "missing", "expected_head": first["head"]})[0], 400)
            self.assertEqual(self.post({"branch": "main", "expected_head": first["head"], "sequence": SEQUENCE})[0], 400)
            remote.assert_not_called()

            def advance(sequence):
                server.NOTES.sequence_save([{"position": 7, "reference": "E", "alternate": "V"}], first["head"])
                return pdb_for(sequence)
            remote.side_effect = advance
            status, result = self.post({"branch": "main", "expected_head": first["head"]})
            self.assertEqual(status, 200)
            self.assertEqual(result, {"head": first["head"], "commit": first["head"], "sequence": SEQUENCE,
                                      "pdb": pdb_for(SEQUENCE), "provider": "ESM Metagenomic Atlas",
                                      "model": "ESMFold"})
            remote.assert_called_once_with(SEQUENCE)
            self.assertNotEqual(server.NOTES.sequence_read()["head"], result["head"])

    def test_selected_commit_and_reference(self):
        first = server.NOTES.save("private note", None, "initial")
        second = server.NOTES.sequence_save(
            [{"position": 7, "reference": "E", "alternate": "V"}], first["head"])
        third = server.NOTES.sequence_save(
            [{"position": 7, "reference": "E", "alternate": "A"}], second["head"])
        before = server.NOTES.sequence_read()
        with patch.object(prediction, "_request", side_effect=pdb_for) as remote:
            for selected, sequence in ((second["head"], second["sequence"]),
                                       (first["head"], SEQUENCE), ("reference", SEQUENCE),
                                       (third["head"], third["sequence"])):
                with self.subTest(selected=selected):
                    status, result = self.post({"branch": "main", "expected_head": third["head"],
                                                "commit": selected})
                    self.assertEqual(status, 200)
                    self.assertEqual(result, {"head": third["head"], "commit": selected,
                                              "sequence": sequence, "pdb": pdb_for(sequence),
                                              "provider": "ESM Metagenomic Atlas", "model": "ESMFold"})
                    self.assertEqual(remote.call_args.args, (sequence,))
        self.assertEqual(server.NOTES.sequence_read(), before)

    def test_rejected_selectors_do_not_disclose_or_call_provider(self):
        first = server.NOTES.save("private note", None, "initial")
        server.NOTES.create_branch("other", "main", first["head"])
        unrelated = server.NOTES.sequence_save(
            [{"position": 7, "reference": "E", "alternate": "V"}],
            first["head"], branch="other")
        blob = server.NOTES._git("rev-parse", first["head"] + ":note.md").stdout.decode().strip()
        with patch.object(prediction, "_request") as remote:
            for selector, expected, status in (
                (unrelated["head"], first["head"], 400),
                (blob, first["head"], 400),
                ("a" * 40, first["head"], 400),
                (first["head"][:12], first["head"], 400),
                (None, first["head"], 400),
                (["reference"], first["head"], 400),
                ("reference", unrelated["head"], 409),
                (unrelated["head"], unrelated["head"], 409),
            ):
                with self.subTest(selector=selector, expected=expected):
                    actual, result = self.post({"branch": "main", "expected_head": expected,
                                                "commit": selector})
                    self.assertEqual(actual, status)
                    self.assertEqual(set(result), {"error"})
                    self.assertNotIn(SEQUENCE, json.dumps(result))
                    self.assertNotIn("private note", json.dumps(result))
            remote.assert_not_called()

    def test_selected_snapshot_survives_branch_advance_during_resolution(self):
        first = server.NOTES.save("note", None, "initial")
        second = server.NOTES.sequence_save(
            [{"position": 7, "reference": "E", "alternate": "V"}], first["head"])
        original = server.NOTES._reachable

        def advance(commit, head):
            server.NOTES.sequence_save(
                [{"position": 7, "reference": "E", "alternate": "A"}], second["head"])
            original(commit, head)

        with patch.object(server.NOTES, "_reachable", side_effect=advance), \
                patch.object(prediction, "_request", side_effect=pdb_for) as remote:
            status, result = self.post({"branch": "main", "expected_head": second["head"],
                                        "commit": first["head"]})
        self.assertEqual(status, 200)
        self.assertEqual((result["head"], result["commit"], result["sequence"]),
                         (second["head"], first["head"], SEQUENCE))
        remote.assert_called_once_with(SEQUENCE)
        self.assertNotEqual(server.NOTES.sequence_read()["head"], result["head"])

    def test_mismatched_provider_output_fails_http(self):
        first = server.NOTES.save("note", None, "initial")
        with patch.object(prediction.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = Response(pdb_for("A" + SEQUENCE[1:]).encode())
            status, result = self.post({"branch": "main", "expected_head": first["head"]})
        self.assertEqual(status, 502)
        self.assertNotIn("pdb", result)


if __name__ == "__main__":
    unittest.main()
