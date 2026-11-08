import json
import os
import tempfile
import unittest
from unittest import mock

from backend import agent_plan
from backend.git_history import GitHistory, InvalidInput, StaleHead


class Response:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def read(self, limit):
        return self.body[:limit]


def envelope(result):
    return json.dumps({"candidates": [{"finishReason": "STOP", "content": {
        "parts": [{"text": json.dumps(result)}]}}]}).encode()


class AgentPlanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.history = GitHistory(os.path.join(self.tmp.name, "history.git"))
        patch = mock.patch.dict(os.environ, {"GEMINI_API_KEY": "test-secret"})
        patch.start()
        self.addCleanup(patch.stop)

    def propose(self, result=None):
        if result is None:
            result = {"changes": [{"position": 2, "alternate": "A"}]}
        opener = mock.Mock()
        opener.open.return_value = Response(envelope(result))
        with mock.patch.object(agent_plan.urllib.request, "build_opener", return_value=opener):
            plan = agent_plan.propose(self.history, "Change residue 2 to A", consent=True)
        return plan, opener.open.call_args

    def test_proposal_and_approval(self):
        note = self.history.save("private note", None, "initial")
        plan, call = self.propose()
        request = call.args[0]
        payload = json.loads(request.data)
        content = json.loads(payload["contents"][0]["parts"][0]["text"])
        self.assertEqual(content["question"], "Change residue 2 to A")
        self.assertNotIn("private note", request.data.decode())
        self.assertNotIn("test-secret", request.data.decode())
        self.assertEqual(call.kwargs["timeout"], 30)
        self.assertEqual(plan["base_head"], note["head"])
        self.assertEqual(plan["changes"], [{"position": 2, "reference": "V", "old": "V", "new": "A"}])
        self.assertIn("Unverified", plan["details"])
        self.assertIn("not edits to a real genome", plan["limitations"])
        self.assertEqual(self.history.sequence_read()["substitutions"], [])
        for value in (None, False, 1):
            with self.assertRaises(InvalidInput):
                agent_plan.commit_plan(self.history, plan, approved=value)
        saved = agent_plan.commit_plan(self.history, plan, approved=True)
        self.assertEqual(saved["substitutions"], plan["substitutions"])
        self.assertEqual(self.history.read()["content"], "private note")

    def test_reversion_and_current_substitutions(self):
        self.history.sequence_save([{"position": 2, "reference": "V", "alternate": "A"}], None)
        plan, call = self.propose({"changes": [{"position": 2, "alternate": "V"}]})
        self.assertEqual(plan["changes"][0]["old"], "A")
        self.assertEqual(plan["substitutions"], [])
        self.assertIn('"alternate": "A"', json.loads(call.args[0].data)["contents"][0]["parts"][0]["text"])
        self.assertEqual(agent_plan.commit_plan(self.history, plan, approved=True)["substitutions"], [])

    def test_stale_head_and_bounded_approval(self):
        plan, _ = self.propose()
        self.history.save("advance", None, "other")
        with self.assertRaises(StaleHead):
            agent_plan.commit_plan(self.history, plan, approved=True)
        plan, _ = self.propose()
        plan["substitutions"] = [{"position": i, "reference": r, "alternate": "A" if r != "A" else "C"}
                                 for i, r in enumerate("MVHLTP", 1)]
        with self.assertRaises(InvalidInput):
            agent_plan.commit_plan(self.history, plan, approved=True)

    def test_bad_input_and_unavailable_key(self):
        with mock.patch.object(agent_plan, "_request") as provider:
            for question, consent in [("", True), ("x" * 2001, True), ("x", 1), ("\ud800", True)]:
                with self.assertRaises(InvalidInput):
                    agent_plan.propose(self.history, question, consent=consent)
            with mock.patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
                with self.assertRaises(agent_plan.AgentUnavailable):
                    agent_plan.propose(self.history, "x", consent=True)
            provider.assert_not_called()

    def test_rejects_invalid_model_output(self):
        bad = [{"changes": [{"position": True, "alternate": "A"}]},
               {"changes": [{"position": 2, "alternate": "V"}]},
               {"changes": [{"position": 2, "alternate": "A", "citation": "fake"}]},
               {"changes": [{"position": 2, "alternate": "A"}] * 2},
               {"changes": [{"position": i, "alternate": "C"} for i in range(1, 7)]},
               {"changes": [], "extra": 1}]
        for output in bad:
            with self.subTest(output=output), self.assertRaises(agent_plan.AgentResponseError):
                self.propose(output)
        with self.assertRaisesRegex(InvalidInput, "could not map"):
            self.propose({"changes": []})
        with mock.patch.object(agent_plan, "_request", return_value='{"changes":[],"changes":[]}'):
            with self.assertRaises(agent_plan.AgentResponseError):
                agent_plan.propose(self.history, "x", consent=True)

    def test_provider_failure_and_bad_envelope(self):
        opener = mock.Mock()
        with mock.patch.object(agent_plan.urllib.request, "build_opener", return_value=opener):
            opener.open.side_effect = OSError("test-secret")
            with self.assertRaises(agent_plan.AgentUnavailable) as error:
                agent_plan.propose(self.history, "x", consent=True)
            self.assertNotIn("test-secret", str(error.exception))
            opener.open.side_effect = None
            for body in (b"x" * (agent_plan.agent.MAX_RESPONSE_BYTES + 1),
                         b'{"candidates":[{"finishReason":"MAX_TOKENS"}]}'):
                opener.open.return_value = Response(body)
                with self.assertRaises(agent_plan.AgentResponseError):
                    agent_plan.propose(self.history, "x", consent=True)


if __name__ == "__main__":
    unittest.main()
