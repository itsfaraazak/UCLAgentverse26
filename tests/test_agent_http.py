import http.client
import json
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from backend import server
from backend.git_history import GitHistory


class AgentHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_notes = server.NOTES
        server.NOTES = GitHistory(Path(self.temp.name) / "notes.git")
        server.AGENT_PROPOSALS.clear()
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        server.NOTES = self.old_notes
        server.AGENT_PROPOSALS.clear()
        self.temp.cleanup()

    def post(self, path, body):
        connection = http.client.HTTPConnection("127.0.0.1", self.http.server_port, timeout=5)
        connection.request("POST", path, json.dumps(body), {"Content-Type": "application/json"})
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_consent_proposal_approval_and_stale_head(self):
        proposal = {"base_head": None, "substitutions": [{"position": 7, "reference": "E", "alternate": "V"}]}
        request = {"positions": [7], "alternatives": None, "consent": False}
        with patch.object(server.agent, "research", return_value=proposal) as research:
            self.assertEqual(self.post("/api/agent/propose", request)[0], 400)
            research.assert_not_called()
            status, result = self.post("/api/agent/propose", {**request, "consent": True})
            self.assertEqual(status, 200)
            token = result["token"]
            self.assertEqual(self.post("/api/agent/commit", {"token": token, "approved": False})[0], 400)
            server.NOTES.save("A newer note", None, "note")
            self.assertEqual(self.post("/api/agent/commit", {"token": token, "approved": True})[0], 409)
            self.assertEqual(server.NOTES.sequence_read()["substitutions"], [])
            self.assertEqual(self.post("/api/agent/commit", {"token": token, "approved": True})[0], 409)

    def test_missing_model_is_reported_without_fallback(self):
        with patch.object(server.agent, "research", side_effect=server.agent.AgentUnavailable("Model not configured.")):
            status, body = self.post("/api/agent/propose", {"positions": [7], "alternatives": None, "consent": True})
        self.assertEqual(status, 503)
        self.assertIn("not configured", body["error"])

    def test_explanation_uses_server_comparison_without_notes(self):
        first = server.NOTES.save("private note stays local", None, "note")
        second = server.NOTES.sequence_save([{"position": 7, "reference": "E", "alternate": "V"}], first["head"])
        request = {"from": first["head"], "to": second["head"], "question": "What changed?", "consent": True}
        with patch.object(server.agent_explain, "explain", return_value={"explanation": "unverified"}) as explain:
            status, _ = self.post("/api/agent/explain", {**request, "consent": False})
            self.assertEqual(status, 400)
            explain.assert_not_called()
            status, _ = self.post("/api/agent/explain", request)
            self.assertEqual(status, 200)
            args, kwargs = explain.call_args
            self.assertEqual(args, ("What changed?", [{"position": 7, "old": "E", "new": "V"}],
                                    first["head"], second["head"]))
            self.assertEqual(kwargs, {"opted_in": True})
            self.assertNotIn("private note", str(args))

    def test_approved_proposal_creates_real_sequence_commit(self):
        proposal = {"base_head": None, "substitutions": [{"position": 7, "reference": "E", "alternate": "V"}]}
        with patch.object(server.agent, "research", return_value=proposal):
            _, result = self.post("/api/agent/propose", {"positions": [7], "alternatives": None, "consent": True})
        status, state = self.post("/api/agent/commit", {"token": result["token"], "approved": True})
        self.assertEqual(status, 200)
        self.assertEqual(state["sequence"][6], "V")
        self.assertIn('"alternate": "V"', server.NOTES.diff(state["head"], "sequence.json"))

    def test_full_and_inflight_queue_does_not_call_provider(self):
        request = {"positions": [7], "alternatives": None, "consent": True}
        now = time.monotonic()
        server.AGENT_PROPOSALS.update({str(i): (now, {}) for i in range(63)})
        entered, release = threading.Event(), threading.Event()
        results = []

        def slow_research(*args, **kwargs):
            entered.set()
            release.wait(5)
            return {"base_head": None, "substitutions": []}

        def generate():
            results.append(server.agent_propose(request))

        with patch.object(server.agent, "research", side_effect=slow_research) as research:
            worker = threading.Thread(target=generate)
            worker.start()
            try:
                self.assertTrue(entered.wait(5))
                with self.assertRaises(server.APIError) as caught:
                    server.agent_propose(request)
                self.assertEqual(caught.exception.status, 429)
                self.assertEqual(research.call_count, 1)
            finally:
                release.set()
                worker.join(5)
        self.assertFalse(worker.is_alive())
        self.assertEqual(len(results), 1)

    def test_source_verified_plan_is_bound_to_branch_and_requires_approval(self):
        base = server.NOTES.save("existing note", None, "Initial")
        server.NOTES.create_branch("experiment", "main", base["head"])
        plan = {"base_head": base["head"], "substitutions": [
            {"position": 7, "reference": "E", "alternate": "V"}], "changes": [{"position": 7}]}
        payload = {"branch": "experiment", "confirmed": True}
        with patch.object(server.known_variant, "propose", return_value=plan) as provider:
            status, result = self.post("/api/agent/hbs-example", payload)
            self.assertEqual(status, 200)
            provider.assert_called_once()
        token = result["token"]
        self.assertEqual(self.post("/api/agent/commit", {"token": token, "approved": False})[0], 400)
        self.assertEqual(self.post("/api/agent/commit", {
            "token": token, "approved": True, "message": "bad\nmessage"})[0], 400)
        status, state = self.post("/api/agent/commit", {
            "token": token, "approved": True, "message": "Explore E7V"})
        self.assertEqual(status, 200)
        self.assertEqual(state["sequence"][6], "V")
        self.assertEqual(server.NOTES.sequence_read("main")["head"], base["head"])
        self.assertEqual(server.NOTES.sequence_read("experiment")["head"], state["head"])
        self.assertEqual(state["history"][0]["message"], "Explore E7V")

    def test_plan_rejects_invalid_or_stale_branch_before_commit(self):
        base = server.NOTES.save("note", None, "Initial")
        server.NOTES.create_branch("experiment", "main", base["head"])
        plan = {"base_head": base["head"], "substitutions": [
            {"position": 7, "reference": "E", "alternate": "V"}], "changes": [{"position": 7}]}
        with patch.object(server.known_variant, "propose", return_value=plan) as provider:
            status, _ = self.post("/api/agent/hbs-example", {"branch": "missing", "confirmed": True})
            self.assertEqual(status, 400)
            provider.assert_not_called()
            status, result = self.post("/api/agent/hbs-example", {"branch": "experiment", "confirmed": True})
            self.assertEqual(status, 200)
        server.NOTES.save("new note", base["head"], "new note", "experiment")
        status, _ = self.post("/api/agent/commit", {"token": result["token"], "approved": True, "message": "Try E7V"})
        self.assertEqual(status, 409)
        self.assertEqual(server.NOTES.sequence_read("experiment")["substitutions"], [])

    def test_legacy_unsourced_goal_cannot_create_a_proposal(self):
        with patch.object(server.agent_plan, "propose") as provider:
            status, _ = self.post("/api/agent/plan", {"question": "Improve HBB", "branch": "main", "consent": True})
        self.assertEqual(status, 400)
        provider.assert_not_called()

    def test_research_conversation_returns_clarifications_or_sourced_plan(self):
        messages = [{"role": "user", "content": "Help me study sickle hemoglobin"}]
        body = {"branch": "main", "messages": messages, "consent": True}
        with patch.object(server.goal_agent, "respond", return_value={
                "status": "clarification", "questions": ["What aspect do you want to study?"], "sources": []}):
            status, result = self.post("/api/agent/plan", body)
        self.assertEqual(status, 200)
        self.assertEqual(result["questions"], ["What aspect do you want to study?"])
        self.assertNotIn("token", result)
        source = {"id": "123", "title": "A study", "url": "https://pubmed.ncbi.nlm.nih.gov/123/",
                  "query": "HBB", "retrieved_at": "now", "abstract_excerpt": "Public abstract.",
                  "provider": "Europe PMC", "provider_record_url": "https://europepmc.org/article/MED/123"}
        with patch.object(server.goal_agent, "respond", return_value={
                "status": "plan", "sources": [source], "used_source_ids": ["123"], "interpretation": "A tentative interpretation.",
                "next_steps": ["Read the paper."], "uncertainties": ["Abstract only."], "limitations": "Not verified."}):
            status, result = self.post("/api/agent/plan", body)
        self.assertEqual(status, 200)
        self.assertEqual(result["plan"]["citations"][0]["url"], source["url"])
        self.assertEqual(result["plan"]["source_records"][0]["query"], "HBB")
        self.assertNotIn("token", result)

    def test_broad_workspace_question_gets_a_direct_local_answer(self):
        decision = {"action": "answer", "message": "This is your HBB workspace.", "query": "", "changes": []}
        with patch.object(server.goal_agent, "_model", return_value=decision), \
             patch.dict("os.environ", {"GEMINI_API_KEY": "test-only"}):
            status, result = self.post("/api/agent/plan", {
                "branch": "main", "messages": [{"role": "user", "content": "Hey explain me this?"}],
                "consent": True})
        self.assertEqual(status, 200)
        self.assertIn("HBB workspace", result["assistant_message"])
        self.assertNotIn("searched the literature", result["assistant_message"].lower())
        self.assertNotIn("token", result)

    def test_published_example_needs_explicit_choice_and_review(self):
        proposal = {"base_head": None, "substitutions": [
            {"position": 7, "reference": "E", "alternate": "V"}],
            "changes": [{"position": 7, "reference": "E", "old": "E", "new": "V"}]}
        with patch.object(server.known_variant, "propose", return_value=proposal) as fetch:
            status, _ = self.post("/api/agent/hbs-example", {"branch": "main", "confirmed": False})
            self.assertEqual(status, 400)
            fetch.assert_not_called()
            status, result = self.post("/api/agent/hbs-example", {"branch": "main", "confirmed": True})
        self.assertEqual(status, 200)
        self.assertIsNone(server.NOTES.sequence_read()["head"])
        status, state = self.post("/api/agent/commit", {
            "token": result["token"], "approved": True, "message": "Compare published HbS"})
        self.assertEqual(status, 200)
        self.assertEqual(state["sequence"][6], "V")

    def test_research_rejects_changed_branch_during_model_call(self):
        base = server.NOTES.save("note", None, "Initial")
        def change_branch(*args, **kwargs):
            server.NOTES.sequence_save([{"position": 7, "reference": "E", "alternate": "V"}], base["head"])
            return {"status": "clarification", "questions": ["Which aspect?"], "sources": []}
        with patch.object(server.goal_agent, "respond", side_effect=change_branch):
            status, result = self.post("/api/agent/plan", {
                "branch": "main", "messages": [{"role": "user", "content": "Research HBB"}], "consent": True})
        self.assertEqual(status, 409)
        self.assertIn("Branch changed", result["error"])

    def test_agent_proposal_requires_explicit_commit(self):
        decision = {"action": "propose", "message": "I can prepare a sequence hypothesis.",
                    "query": "", "changes": [{"position": 7, "alternate": "V", "expected_old": ""}]}
        with patch.object(server.goal_agent, "_model", return_value=decision), \
             patch.dict("os.environ", {"GEMINI_API_KEY": "test-only"}):
            status, result = self.post("/api/agent/plan", {
                "branch": "main", "messages": [{"role": "user", "content": "Represent the HbS variant"}],
                "consent": True})
        self.assertEqual(status, 200)
        self.assertEqual(result["proposal"]["changes"][0]["new"], "V")
        self.assertIsNone(server.NOTES.sequence_read()["head"])
        status, state = self.post("/api/agent/commit", {
            "token": result["token"], "approved": True, "message": "Research hypothesis"})
        self.assertEqual(status, 200)
        self.assertEqual(state["sequence"][6], "V")

    def test_model_proposal_is_bound_to_branch_and_rejects_stale_head(self):
        base = server.NOTES.save("note", None, "Initial")
        server.NOTES.create_branch("experiment", "main", base["head"])
        decision = {"action": "propose", "message": "I prepared a hypothesis.",
                    "query": "", "changes": [{"position": 7, "alternate": "V", "expected_old": ""}]}
        with patch.object(server.goal_agent, "_model", return_value=decision), \
             patch.dict("os.environ", {"GEMINI_API_KEY": "test-only"}):
            status, result = self.post("/api/agent/plan", {
                "branch": "experiment", "messages": [{"role": "user", "content": "Prepare a variant"}],
                "consent": True})
        self.assertEqual(status, 200)
        server.NOTES.save("updated note", base["head"], "Update", "experiment")
        status, _ = self.post("/api/agent/commit", {
            "token": result["token"], "approved": True, "message": "Hypothesis"})
        self.assertEqual(status, 409)
        self.assertEqual(server.NOTES.sequence_read("main")["head"], base["head"])
        self.assertEqual(server.NOTES.sequence_read("experiment")["substitutions"], [])


if __name__ == "__main__":
    unittest.main()
