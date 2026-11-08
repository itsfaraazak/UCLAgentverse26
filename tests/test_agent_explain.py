import io
import json
import os
import unittest
import urllib.error
from unittest.mock import patch

from backend import agent_explain as agent
from backend.git_history import InvalidInput


FROM = "a" * 40
TO = "b" * 40
CHANGE = {"position": 7, "old": "E", "new": "V"}
SECTIONS = {"observations": "Position 7 changes from E to V.",
            "hypotheses": "The substitution might alter local properties.",
            "caveats": "Effects are unknown without independent evidence."}


def envelope(sections=SECTIONS, finish="STOP"):
    return json.dumps({"candidates": [{"finishReason": finish, "content": {
        "parts": [{"text": json.dumps(sections)}]}}]}).encode()


class Response(io.BytesIO):
    pass


class ExplainTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"GEMINI_API_KEY": "test-secret"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def call(self, question="What changed?", changes=None, from_commit=FROM, to_commit=TO,
             opted_in=True):
        return agent.explain(question, [CHANGE] if changes is None else changes,
                             from_commit, to_commit, opted_in=opted_in)

    @patch("backend.agent_explain.urllib.request.build_opener")
    def test_request_and_result(self, build):
        build.return_value.open.return_value = Response(envelope())
        result = self.call()
        request = build.return_value.open.call_args.args[0]
        self.assertIsInstance(build.call_args.args[0], agent._NoRedirect)
        self.assertEqual(build.return_value.open.call_args.kwargs["timeout"], agent.TIMEOUT_SECONDS)
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("X-goog-api-key"), "test-secret")
        payload = json.loads(request.data)
        sent = json.loads(payload["contents"][0]["parts"][0]["text"])
        self.assertEqual(sent, {"question": "What changed?", "changes": [
            {"position": 7, "old": "E", "new": "V", "reference": "E"}]})
        self.assertNotIn(FROM, request.data.decode())
        self.assertNotIn(TO, request.data.decode())
        self.assertEqual((result["from_commit"], result["to_commit"], result["unverified"]),
                         (FROM, TO, True))
        self.assertEqual(result["explanation"], "Recorded sequence differences\nPosition 7: E → V (reference E)."
                         + "\n\nUnverified model interpretation\n" + SECTIONS["hypotheses"]
                         + "\n\nModel-reported caveats\n" + SECTIONS["caveats"])
        self.assertTrue(all(source["role"] == "context, not evidence for model claims"
                            for source in result["sources"]))
        self.assertNotIn("test-secret", json.dumps(result))

    @patch("backend.agent_explain._gemini", return_value=json.dumps(SECTIONS))
    def test_empty_changes_reversal_and_alternate(self, model):
        result = self.call(changes=[])
        self.assertIn("No sequence differences", result["explanation"])
        self.assertNotIn(SECTIONS["observations"], result["explanation"])
        self.assertEqual(model.call_args.args[2], [])
        self.call(changes=[{"position": 7, "old": "V", "new": "A", "reference": "E"},
                           {"position": 2, "old": "L", "new": "V"}])
        self.assertEqual(model.call_args.args[2], [
            {"position": 2, "old": "L", "new": "V", "reference": "V"},
            {"position": 7, "old": "V", "new": "A", "reference": "E"}])
        self.call(question="x" * 600, from_commit="a" * 64, to_commit="b" * 64)

    @patch("backend.agent_explain._gemini")
    def test_model_observations_cannot_override_comparison(self, model):
        model.return_value = json.dumps({**SECTIONS, "observations": "Position 9 changes from X to Z."})
        text = self.call()["explanation"]
        self.assertIn("Position 7: E → V", text)
        self.assertNotIn("Position 9", text)

    @patch("backend.agent_explain._gemini")
    def test_invalid_inputs_never_call_provider(self, model):
        invalid = [
            {"opted_in": False}, {"opted_in": 1}, {"question": " "},
            {"question": "x" * 601}, {"question": {}},
            {"from_commit": "main"}, {"from_commit": "A" * 40},
            {"to_commit": "b" * 64}, {"changes": {}},
            {"changes": [CHANGE, CHANGE]},
            {"changes": [{"position": True, "old": "E", "new": "V"}]},
            {"changes": [{"position": 148, "old": "E", "new": "V"}]},
            {"changes": [{"position": 7, "old": "E", "new": "E"}]},
            {"changes": [{"position": 7, "old": "E", "new": "X"}]},
            {"changes": [{**CHANGE, "reference": "V"}]},
            {"changes": [{**CHANGE, "note": "private"}]},
            {"changes": [{"sequence": {"changes": [CHANGE]}}]},
            {"changes": [CHANGE] * 148},
        ]
        for args in invalid:
            with self.subTest(args=args), self.assertRaises(InvalidInput):
                self.call(**args)
        model.assert_not_called()

    @patch("backend.agent_explain._gemini")
    def test_missing_key(self, model):
        with patch.dict(os.environ, {"GEMINI_API_KEY": " "}), self.assertRaises(agent.AgentUnavailable):
            self.call()
        model.assert_not_called()

    @patch("backend.agent_explain._gemini")
    def test_bad_model_outputs(self, model):
        bad = ["not json", "[]", "{}", '{"observations":"a","observations":"b"}',
               json.dumps({**SECTIONS, "extra": "x"}),
               json.dumps({**SECTIONS, "caveats": ""}),
               json.dumps({**SECTIONS, "hypotheses": ["x"]}),
               json.dumps({**SECTIONS, "caveats": "x" * 4001}),
               json.dumps({**SECTIONS, "caveats": "bad\u0000text"}),
               "x" * (agent.MAX_RESPONSE_BYTES + 1), None]
        for raw in bad:
            model.return_value = raw
            with self.subTest(raw=str(raw)[:100]), self.assertRaises(agent.AgentResponseError):
                self.call()

    @patch("backend.agent_explain.urllib.request.build_opener")
    def test_provider_envelope_and_errors(self, build):
        opener = build.return_value
        bodies = [b"{}", b"not json", envelope(finish="MAX_TOKENS"),
                  b'{"candidates":[]}', b'{"candidates":null}',
                  b'{"candidates":[{"finishReason":"STOP","content":{"parts":[]}}]}',
                  b'{"candidates":[],"candidates":[]}', b"x" * (agent.MAX_RESPONSE_BYTES + 1)]
        for body in bodies:
            opener.open.return_value = Response(body)
            with self.subTest(body=body[:100]), self.assertRaises(agent.AgentResponseError):
                self.call()
        for error in (urllib.error.URLError("test-secret"), TimeoutError("test-secret"),
                      urllib.error.HTTPError("url", 302, "test-secret", {}, None)):
            opener.open.side_effect = error
            with self.subTest(error=type(error)), self.assertRaises(agent.AgentUnavailable) as caught:
                self.call()
            self.assertNotIn("test-secret", str(caught.exception))

    def test_redirect_handler_rejects_redirects(self):
        self.assertIsNone(agent._NoRedirect().redirect_request(None, None, 302, "", {}, "https://evil.example"))


if __name__ == "__main__":
    unittest.main()
