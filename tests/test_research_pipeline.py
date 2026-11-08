import json
import unittest

from backend import server


def artifact(summary, text, source):
    return json.dumps({"summary": summary, "claims": [{"text": text, "source_ids": [source]}]})


FIRST = artifact("Human oversight and governance.", "Human oversight and uncertainty.", "WHO")
SECOND = artifact("Base editing evidence and limitations.", "Assay limitations and uncertainty.", "GUIDE")
REVIEW = json.dumps({"assessment": "gaps", "reason": "Evidence and uncertainty are limited."})


class ResearchPipelineTests(unittest.TestCase):
    def test_generated_artifacts_reach_reviewer_and_output(self):
        answers = iter([FIRST, SECOND, REVIEW])
        prompts = []
        def caller(model, prompt, key):
            prompts.append(prompt)
            return next(answers)

        result = server.run_pipeline("Review evidence", "key", caller)
        self.assertEqual(result["agents"][0]["summary"], json.loads(FIRST)["summary"])
        self.assertEqual(result["agents"][1]["claims"], json.loads(SECOND)["claims"])
        self.assertNotIn(json.loads(FIRST)["summary"], prompts[1])
        self.assertIn(json.loads(FIRST)["summary"], prompts[2])
        self.assertIn(json.loads(SECOND)["summary"], prompts[2])
        self.assertIn("Model judgment: gaps", result["checks"][2]["detail"])
        self.assertEqual(result["checks"][2]["status"], "warn")
        for prompt in prompts:
            self.assertIn(server.FIXTURE["sources"][2]["evidence"], prompt)
            self.assertIn(server.FIXTURE["sources"][3]["limitations"], prompt)
        self.assertEqual(result["checks"][3]["status"], "warn")
        self.assertIn("original sources", result["checks"][3]["detail"])

    def test_scripted_study_claims_have_attributed_evidence_and_limits(self):
        result = server.run_pipeline("Review base editing evidence", None)
        sources = {source["id"]: source for source in server.FIXTURE["sources"]}
        claims = [claim for agent in result["agents"] for claim in agent["claims"]]
        for source_id in ("ABE", "GUIDE"):
            self.assertTrue(any(source_id in claim["source_ids"] for claim in claims))
            self.assertEqual(sources[source_id]["kind"], "peer-reviewed research")
            self.assertTrue(sources[source_id]["evidence"])
            self.assertTrue(sources[source_id]["limitations"])
            self.assertIn("pubmed.ncbi.nlm.nih.gov", sources[source_id]["url"])
        self.assertEqual(result["checks"][3]["status"], "warn")

    def test_fixture_labels_source_scope_and_limits(self):
        sources = {source["id"]: source for source in server.FIXTURE["sources"]}
        for source_id in ("WHO", "NASEM"):
            self.assertEqual(sources[source_id]["kind"], "governance report")
            self.assertIn("not an experimental study", sources[source_id]["limitations"])
        for source_id in ("ABE", "GUIDE"):
            self.assertIn("Abstract-level", sources[source_id]["evidence"])
            self.assertIn("not verified support", sources[source_id]["limitations"])
        self.assertIn("not a direct base-editor safety assay", sources["GUIDE"]["limitations"])

    def test_rejects_unsafe_and_invalid_model_content(self):
        for bad in [
            artifact("Human oversight and governance.", "ACGTACGTACGT", "WHO"),
            artifact("Human oversight and governance.", "Mix samples and incubate.", "WHO"),
            artifact("Human oversight and governance.", "Human oversight and uncertainty.", "OTHER"),
            '{"summary":"x","claims":[]}',
        ]:
            with self.subTest(bad=bad), self.assertRaises(server.APIError):
                server.run_pipeline("Review evidence", "key", lambda *args: bad)

    def test_reviewer_failure_and_provider_error_fail_closed(self):
        for final in ['not json', '{"assessment":"complete","reason":"Mix samples."}']:
            answers = iter([FIRST, SECOND, final])
            with self.subTest(final=final), self.assertRaises(server.APIError):
                server.run_pipeline("Review evidence", "key", lambda *args: next(answers))
        def failed(*args):
            raise RuntimeError("secret provider error")
        store = server.Store("secret", failed)
        with self.assertRaises(server.APIError) as error:
            store.run("Review evidence", 0)
        self.assertNotIn("secret", str(error.exception))
        self.assertEqual(store.snapshot()["agents"], [])
        self.assertIn("error", store.snapshot())

    def test_identical_artifacts_rejected(self):
        with self.assertRaises(server.APIError):
            server.run_pipeline("Review evidence", "key", lambda *args: FIRST)
