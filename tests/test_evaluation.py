"""Regression tests for the evaluation labels and explicit check boundaries."""
import contextlib
import io
import unittest

import evaluation
from backend import server, versioning


class EvaluationTests(unittest.TestCase):
    def test_each_documented_check_against_fixture_labels(self):
        for name, artifact, evidence, unique in evaluation.CASES:
            with self.subTest(case=name):
                results = {item["name"]: item["status"] for item in versioning.checks(artifact)}
                self.assertEqual(results, {
                    "Evidence references": "pass" if evidence else "fail",
                    "Unique claims": "pass" if unique else "fail",
                })

    def test_evaluation_confusion_counts(self):
        with contextlib.redirect_stdout(io.StringIO()):
            counts = evaluation.evaluate()
        self.assertEqual(counts["checks"], {"tp": 4, "tn": 6, "fp": 0, "fn": 0})
        self.assertEqual(counts["baseline"], {"tp": 4, "tn": 1, "fp": 5, "fn": 0})

    def test_passing_checks_do_not_verify_citation_or_scientific_truth(self):
        # An unknown source and unsupported text can still pass.
        item = evaluation.artifact(("Unsupported assertion", ["NOT_A_SOURCE"]))
        self.assertTrue(all(c["status"] == "pass" for c in versioning.checks(item)))

    def test_draft_boundary_examples(self):
        self.assertEqual(server.validate_draft("  Review evidence  "), "Review evidence")
        for value in ("", "ACGTACGT", "Review evidence 123", "Mix samples", "a" * 501):
            with self.subTest(value=value), self.assertRaises(server.APIError):
                server.validate_draft(value)

    def test_provider_receives_categories_not_original_draft(self):
        prompts = []
        responses = iter([
            '{"summary":"Human oversight and governance.","claims":[{"text":"Human oversight and uncertainty.","source_ids":["WHO"]}]}',
            '{"summary":"Base editing evidence and limitations.","claims":[{"text":"Assay limitations and uncertainty.","source_ids":["GUIDE"]}]}',
            '{"assessment":"gaps","reason":"Evidence and uncertainty are limited."}',
        ])

        def caller(model, prompt, key):
            prompts.append(prompt)
            return next(responses)

        draft = "Please review human oversight and evidence"
        server.run_pipeline(server.validate_draft(draft), "test-key", caller)
        self.assertEqual(len(prompts), 3)
        for prompt in prompts:
            self.assertNotIn(draft, prompt)
        self.assertIn('"oversight"', prompts[0])
        self.assertIn('"evidence"', prompts[0])


if __name__ == "__main__":
    unittest.main()
