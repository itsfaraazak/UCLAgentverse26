import json
import os
import unittest
import urllib.error
from unittest import mock

from backend import goal_agent
from backend.git_history import InvalidInput


def envelope(value):
    return json.dumps({"candidates": [{"finishReason": "STOP", "content": {
        "parts": [{"text": json.dumps(value)}]}}]}).encode()


class Response:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def read(self, n):
        return self.value[:n]


class GoalAgentTests(unittest.TestCase):
    def setUp(self):
        self.history = mock.Mock()
        self.history.sequence_read.return_value = {"head": "captured", "substitutions": []}
        patch = mock.patch.dict(os.environ, {"GEMINI_API_KEY": "test-secret"})
        patch.start()
        self.addCleanup(patch.stop)
        self.messages = [{"role": "user", "content": "Study sickle hemoglobin"}]
        self.search = {"action": "research", "message": "I'll look for evidence.",
                       "query": "sickle hemoglobin", "changes": []}
        self.assessment = {"questions": [], "interpretation": "The abstract describes an association.",
                           "next_steps": ["Review the primary study."],
                           "uncertainties": ["The abstract alone is insufficient."],
                           "source_ids": ["123"]}
        self.literature = {"resultList": {"result": [
            {"pmid": "123", "title": "HBB study", "abstractText": "<p>Reported finding.</p>"}]}}

    def call_http(self, *responses):
        opener = mock.Mock()
        opener.open.side_effect = [Response(r) for r in responses]
        with mock.patch.object(goal_agent.urllib.request, "build_opener", return_value=opener):
            result = goal_agent.respond(self.history, self.messages, consent=True)
        return result, opener

    def test_research_uses_real_source_records_and_never_commits(self):
        result, opener = self.call_http(envelope(self.search), json.dumps(self.literature).encode(),
                                        envelope(self.assessment))
        self.assertEqual(result["status"], "plan")
        self.assertEqual(result["sources"][0]["url"], "https://pubmed.ncbi.nlm.nih.gov/123/")
        self.assertEqual(result["sources"][0]["abstract_excerpt"], "Reported finding.")
        self.assertEqual(result["used_source_ids"], ["123"])
        self.assertIsNone(result["proposal"])
        self.history.sequence_save.assert_not_called()
        self.assertEqual(opener.open.call_count, 3)
        calls = opener.open.call_args_list
        self.assertIn("europepmc", calls[1].args[0].full_url)
        self.assertTrue(all(c.kwargs["timeout"] == 15 for c in calls))
        self.assertNotIn("test-secret", calls[0].args[0].data.decode())

    def test_broad_request_and_follow_up_use_current_workspace(self):
        self.history.sequence_read.return_value["substitutions"] = [
            {"position": 7, "reference": "E", "alternate": "V"}]
        self.messages = [{"role": "user", "content": "Hey explain me this?"}]
        answer = {"action": "answer", "message": "This workspace contains E7V.", "query": "", "changes": []}
        result, opener = self.call_http(envelope(answer))
        self.assertEqual(result["status"], "answer")
        self.assertIn("E7V", result["answer"])
        self.assertEqual(opener.open.call_count, 1)
        self.messages += [{"role": "assistant", "content": result["answer"]},
                          {"role": "user", "content": "What about that change?"}]
        self.history.sequence_read.return_value["substitutions"] = [
            {"position": 7, "reference": "E", "alternate": "V"},
            {"position": 6, "reference": "P", "alternate": "A"}]
        answer["message"] = "The current changes are P6A and E7V."
        result, opener = self.call_http(envelope(answer))
        self.assertIn("P6A and E7V", result["answer"])
        self.assertEqual(opener.open.call_count, 1)
        self.messages += [{"role": "assistant", "content": result["answer"]},
                          {"role": "user", "content": "Research the molecular evidence for this substitution"}]
        result, opener = self.call_http(envelope(self.search), json.dumps(self.literature).encode(),
                                        envelope(self.assessment))
        self.assertEqual(result["status"], "plan")
        self.assertIn("E7V", result["interpretation"])
        for call in (opener.open.call_args_list[0], opener.open.call_args_list[2]):
            payload = json.loads(call.args[0].data)
            inputs = json.loads(payload["contents"][0]["parts"][0]["text"])
            self.assertEqual(inputs["messages"], self.messages)
            self.assertEqual(inputs["current_sequence"]["substitutions"][0]["position"], 6)
            self.assertIn("MVHLTAVE", inputs["current_sequence"]["sequence"])
        self.history.sequence_save.assert_not_called()

    def test_follow_up_is_interpreted_by_the_model(self):
        question = "Could you clarify what specific aspect of the selected HBB substitutions you would like explained?"
        self.messages = [{"role": "user", "content": "Hey explain me this?"},
                         {"role": "assistant", "content": "I need more detail.\n" + question},
                         {"role": "user", "content": question}]
        self.history.sequence_read.return_value["substitutions"] = [
            {"position": 7, "reference": "E", "alternate": "K"}]
        answer = {"action": "answer", "message": "E7K changes glutamic acid to lysine.",
                  "query": "", "changes": []}
        with mock.patch.object(goal_agent, "_model", return_value=answer) as provider:
            result = goal_agent.respond(self.history, self.messages, consent=True)
        provider.assert_called_once()
        self.assertIn("E7K", result["answer"])

    def test_empty_evidence_and_insufficient_evidence(self):
        result, opener = self.call_http(envelope(self.search),
                                        json.dumps({"resultList": {"result": []}}).encode())
        self.assertEqual(result["status"], "plan")
        self.assertIn("Substitutions (0): none", result["interpretation"])
        self.assertIn("No usable abstracts", result["interpretation"])
        self.assertEqual(result["used_source_ids"], [])
        self.assertEqual(opener.open.call_count, 2)
        assessment = {**self.assessment, "questions": ["Which mechanism?"], "interpretation": "",
                      "next_steps": [], "source_ids": []}
        result, _ = self.call_http(envelope(self.search), json.dumps(self.literature).encode(),
                                   envelope(assessment))
        self.assertEqual(result["status"], "plan")
        self.assertEqual(len(result["sources"]), 1)
        self.assertEqual(result["used_source_ids"], [])
        self.assertIn("did not establish", result["interpretation"])
        self.assertIn("Which mechanism?", result["next_steps"])

    def test_unsourced_model_interpretation_is_not_returned(self):
        assessment = {**self.assessment, "source_ids": [],
                      "interpretation": "This change has a made-up effect.",
                      "next_steps": ["Make an unsupported sequence edit."]}
        result, _ = self.call_http(envelope(self.search), json.dumps(self.literature).encode(),
                                   envelope(assessment))
        self.assertNotIn("made-up", result["interpretation"])
        self.assertNotIn("unsupported", " ".join(result["next_steps"]))
        self.assertIsNone(result["proposal"])

    def test_long_overly_specific_query_retries_a_broader_search(self):
        search = {**self.search, "query": "hemoglobin S variant E6V E7V structure"}
        result, opener = self.call_http(envelope(search), json.dumps({"resultList": {"result": []}}).encode(),
                                        json.dumps(self.literature).encode(), envelope(self.assessment))
        self.assertEqual(result["status"], "plan")
        self.assertEqual(opener.open.call_count, 4)
        self.assertEqual(result["sources"][0]["query"], "HBB AND (hemoglobin AND S AND variant)")

    def test_rejects_fabricated_source_and_bad_query(self):
        with self.assertRaises(goal_agent.AgentResponseError):
            self.call_http(envelope(self.search), json.dumps(self.literature).encode(),
                           envelope({**self.assessment, "source_ids": ["999"]}))
        with self.assertRaises(goal_agent.AgentResponseError):
            self.call_http(envelope({**self.search, "query": 'HBB OR "all"'}))

    def test_detailed_but_bounded_interpretation(self):
        detailed = {**self.assessment, "interpretation": "Relevant source context. " * 40}
        result, _ = self.call_http(envelope(self.search), json.dumps(self.literature).encode(), envelope(detailed))
        self.assertEqual(result["status"], "plan")
        self.assertGreater(len(result["interpretation"]), 600)
        with self.assertRaises(goal_agent.AgentResponseError):
            self.call_http(envelope(self.search), json.dumps(self.literature).encode(),
                           envelope({**self.assessment, "interpretation": "x" * 2001}))

    def test_rejects_model_cure_claim_even_with_a_real_source_id(self):
        with self.assertRaises(goal_agent.AgentResponseError):
            self.call_http(envelope(self.search), json.dumps(self.literature).encode(),
                           envelope({**self.assessment, "interpretation": "This mutation cures sickle cell disease."}))

    def test_input_and_missing_key_never_call_provider(self):
        with mock.patch.object(goal_agent, "_model") as provider:
            for messages, consent in [(self.messages, 1), ([], True),
                                      ([{"role": "assistant", "content": "x"}], True),
                                      ([{"role": "user", "content": "x" * 2001}], True)]:
                with self.assertRaises(InvalidInput):
                    goal_agent.respond(self.history, messages, consent=consent)
            with mock.patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
                with self.assertRaises(goal_agent.AgentUnavailable):
                    goal_agent.respond(self.history, self.messages, consent=True)
            provider.assert_not_called()

    def test_provider_error_is_sanitized_and_oversized_rejected(self):
        opener = mock.Mock()
        opener.open.side_effect = urllib.error.URLError("test-secret")
        with mock.patch.object(goal_agent.urllib.request, "build_opener", return_value=opener):
            with self.assertRaises(goal_agent.AgentUnavailable) as caught:
                goal_agent.respond(self.history, self.messages, consent=True)
        self.assertNotIn("test-secret", str(caught.exception))
        with self.assertRaises(goal_agent.AgentResponseError):
            self.call_http(b"x" * 65537)

    def test_provider_failures_are_distinguished_without_leaking_details(self):
        request = goal_agent.urllib.request.Request("https://example.org/")
        for failure, expected in [
            (urllib.error.HTTPError("https://example.org/", 429, "test-secret", {}, None), "rate-limiting"),
            (TimeoutError("test-secret"), "took too long"),
            (urllib.error.URLError("test-secret"), "connection"),
        ]:
            with self.subTest(expected=expected), \
                 mock.patch.object(goal_agent.urllib.request, "build_opener") as opener:
                opener.return_value.open.side_effect = failure
                with self.assertRaises(goal_agent.AgentUnavailable) as caught:
                    goal_agent._fetch(request, "Gemini")
                self.assertIn(expected, str(caught.exception))
                self.assertNotIn("test-secret", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
