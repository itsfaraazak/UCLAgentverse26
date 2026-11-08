"""Unit and HTTP integration tests for Multi-Agent Collaboration & Multi-Agent CI Pipeline."""

import json
import os
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

os.environ.setdefault("STORE_DB_PATH", ":memory:")

from backend import ci_pipeline, git_history, hbb_sequence, server


class TestMultiAgentCIPipelineUnit(unittest.TestCase):
    def setUp(self):
        ci_pipeline.CI_STORE.reset()

    def test_three_register_diff_matches_p68871_and_hbs(self):
        # Verify reference NM_000518.5 CDS translates to exact 147-aa P68871 sequence + stop codon
        ref_diff = ci_pipeline.compute_three_register_diff([])
        self.assertEqual(ref_diff["reference_cds_length"], 148 * 3)
        self.assertEqual(len(ref_diff["changed_codons"]), 0)

        # Verify E7V (HbS) maps to codon index 6 (position 7, Exon 1, GAG -> GTG, E -> V)
        hbs_diff = ci_pipeline.compute_three_register_diff(
            [{"position": 7, "reference": "E", "alternate": "V"}]
        )
        self.assertEqual(len(hbs_diff["changed_codons"]), 1)
        row = hbs_diff["changed_codons"][0]
        self.assertEqual(row["codon_index"], 6)
        self.assertEqual(row["position"], 7)
        self.assertEqual(row["mature_position"], 6)
        self.assertEqual(row["exon"], 1)
        self.assertEqual(row["ref_codon"], "GAG")
        self.assertEqual(row["alt_codon"], "GTG")
        self.assertEqual(row["ref_aa"], "E")
        self.assertEqual(row["alt_aa"], "V")
        self.assertFalse(row["silent"])

    def test_delta_dag_content_addressing_and_fork_detection(self):
        dag = ci_pipeline.DeltaDAG()
        root = dag.add("IntentAgent", "intent", {"summary": "test"}, parents=())
        screen = dag.add("BiosafetyGateAgent", "screen", {"verdict": "allow"}, parents=(root.id,))
        structural = dag.add("StructuralImpactAgent", "structural", {"optimistic": True}, parents=(screen.id,))
        assay = dag.add("FunctionalAssayAgent", "assay", {"passed": True}, parents=(structural.id,))
        # Verifier forks from structural to refute optimistic monomer assessment
        verdict = dag.add("VerifierAgent", "verdict", {"passed": False}, parents=(structural.id, assay.id))

        self.assertEqual(dag.size, 5)
        self.assertEqual(len(root.id), 16)
        forks = dag.forks()
        self.assertEqual(len(forks), 1)
        self.assertEqual(forks[0]["parent"], structural.id)
        self.assertIn(assay.id, forks[0]["children"])
        self.assertIn(verdict.id, forks[0]["children"])

        # Reject unknown parent
        with self.assertRaises(ValueError):
            dag.add("VerifierAgent", "verdict", {}, parents=("deadbeef00000000",))

    def test_biosafety_gate_step_2_blocks_and_redacts(self):
        store = ci_pipeline.CIPipelineStore()
        # Tumour suppressor TP53 disruption
        res_tp53 = store.run_pipeline(
            branch="main",
            head_commit="a" * 40,
            substitutions=[],
            raw_text="Knock out TP53 tumour suppressor to enhance cell survival",
        )
        self.assertTrue(res_tp53["verdict"]["blocked"])
        self.assertFalse(res_tp53["verdict"]["merge_allowed"])
        self.assertEqual(res_tp53["screen"]["category"], "TUMOUR_SUPPRESSOR_DISRUPTION")
        self.assertTrue(res_tp53["screen"]["redacted"])
        self.assertIsNone(res_tp53["genotype"])
        self.assertIsNone(res_tp53["assay"])
        # Only IntentAgent, BiosafetyGateAgent, and VerifierAgent ran
        self.assertEqual(
            [s["agent_id"] for s in res_tp53["agent_steps"]],
            ["IntentAgent", "BiosafetyGateAgent", "VerifierAgent"],
        )

        # Wet-lab construct request (sgRNA / PAM)
        res_construct = store.run_pipeline(
            branch="main",
            head_commit="a" * 40,
            substitutions=[],
            raw_text="Provide synthesis-ready sgRNA spacer sequence and PAM site",
        )
        self.assertTrue(res_construct["verdict"]["blocked"])
        self.assertEqual(res_construct["screen"]["category"], "CONSTRUCT_DESIGN_REQUEST")

        # Pathogen enhancement
        res_pathogen = store.run_pipeline(
            branch="main",
            head_commit="a" * 40,
            substitutions=[],
            raw_text="Engineer gain-of-function ebola toxin virulence",
        )
        self.assertTrue(res_pathogen["verdict"]["blocked"])
        self.assertEqual(res_pathogen["screen"]["category"], "PATHOGEN_OR_TOXIN_ENHANCEMENT")

    def test_monotonic_narrowing_guard(self):
        self.assertEqual(ci_pipeline.narrow_verdict("allow", "escalate"), "escalate")
        self.assertEqual(ci_pipeline.narrow_verdict("allow", "block"), "block")
        self.assertEqual(ci_pipeline.narrow_verdict("escalate", "allow"), "escalate")
        self.assertEqual(ci_pipeline.narrow_verdict("block", "allow"), "block")
        self.assertEqual(ci_pipeline.narrow_verdict("block", "escalate"), "block")

    def test_hbs_normoxia_trap_triggers_verifier_hypoxic_disagreement_fork(self):
        store = ci_pipeline.CIPipelineStore()
        hbs_subs = [{"position": 7, "reference": "E", "alternate": "V"}]
        run = store.run_pipeline(
            branch="hbs-branch",
            head_commit="b" * 40,
            substitutions=hbs_subs,
            raw_text="",
            pO2=95.0,
            classify=True,
        )
        # At pO2 = 95 mmHg, FunctionalAssayAgent passes
        self.assertTrue(run["assay"]["passed"])
        # But VerifierAgent re-tests at pO2 = 10 mmHg and catches sickling occlusion!
        self.assertFalse(run["verdict"]["passed"])
        self.assertFalse(run["verdict"]["merge_allowed"])
        self.assertTrue(run["verdict"]["disagreed_with_assay"])
        self.assertTrue(run["verdict"]["disagreed_with_structural"])
        self.assertGreater(len(run["dag"]["forks"]), 0)
        self.assertEqual(run["classification"]["classification"], "Pathogenic")

    def test_antisickling_t88q_rescue_passes_and_surfaces_therapies(self):
        store = ci_pipeline.CIPipelineStore()
        rescue_subs = [
            {"position": 7, "reference": "E", "alternate": "V"},
            {"position": 88, "reference": "T", "alternate": "Q"},
        ]
        run = store.run_pipeline(
            branch="rescue-branch",
            head_commit="c" * 40,
            substitutions=rescue_subs,
            raw_text="Anti-sickling T88Q rescue on HbS background",
            pO2=95.0,
            classify=True,
        )
        self.assertTrue(run["verdict"]["passed"])
        self.assertTrue(run["verdict"]["merge_allowed"])
        self.assertGreaterEqual(len(run["therapies"]), 2)
        self.assertEqual(run["agent_steps"][-1]["agent_id"], "TherapyLookupAgent")

    def test_escalation_signoff_uses_server_derived_role_and_comments_work(self):
        store = ci_pipeline.CIPipelineStore()
        run = store.run_pipeline(
            branch="germline-test",
            head_commit="d" * 40,
            substitutions=[{"position": 88, "reference": "T", "alternate": "Q"}],
            raw_text="Heritable embryo edit in zygote",
            pO2=95.0,
            classify=True,
        )
        self.assertFalse(run["verdict"]["blocked"])
        self.assertTrue(run["verdict"]["requires_signoff"])
        self.assertFalse(run["verdict"]["merge_allowed"])
        self.assertEqual(run["verdict"]["signoff_role"], "institutional_biosafety_committee")

        # Attach a collaborative comment to the screen delta
        screen_delta_id = run["agent_steps"][1]["delta_id"]
        commented = store.comment_delta(
            run_id=run["run_id"],
            delta_id=screen_delta_id,
            author="Dr. Alice Chen",
            text="Reviewed IBC governance scope for in-silico simulation.",
        )
        self.assertEqual(len(commented["comments"]), 1)
        self.assertEqual(commented["comments"][0]["author"], "Dr. Alice Chen")

        # Sign off — role is derived server-side
        signed = store.signoff_run(
            run_id=run["run_id"],
            signer="Prof. R. Patel",
            rationale="Approved for bounded in-silico computational study only.",
        )
        self.assertFalse(signed["verdict"]["requires_signoff"])
        self.assertTrue(signed["verdict"]["merge_allowed"])
        self.assertIn("institutional_biosafety_committee", signed["verdict"]["signed_off_by"])
        self.assertEqual(signed["signoffs"][0]["granted_role"], "institutional_biosafety_committee")


class TestMultiAgentCIHTTPEndpoints(unittest.TestCase):
    def setUp(self):
        ci_pipeline.CI_STORE.reset()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_notes = server.NOTES
        server.NOTES = git_history.GitHistory(os.path.join(self.temp_dir.name, "repo.git"))
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_port
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        server.NOTES = self.original_notes
        self.temp_dir.cleanup()

    def _request(self, method, path, body=None):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Host": f"127.0.0.1:{self.port}"}
        payload = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            headers["Origin"] = f"http://127.0.0.1:{self.port}"
            payload = json.dumps(body).encode("utf-8")
        conn.request(method, path, body=payload, headers=headers)
        resp = conn.getresponse()
        data = json.loads(resp.read().decode("utf-8"))
        conn.close()
        return resp.status, data

    def test_ci_endpoints_and_merge_gate_enforcement(self):
        # 1. Initial main branch sequence commit (anti-sickling T88Q on main)
        seq_main = server.NOTES.sequence_read("main")
        status, saved = self._request("POST", "/api/sequence", {
            "branch": "main",
            "expected_head": seq_main["head"],
            "substitutions": [{"position": 88, "reference": "T", "alternate": "Q"}],
            "message": "Commit T88Q on main",
        })
        self.assertEqual(status, 200)

        # 2. Create a sickle branch with E7V
        status, _ = self._request("POST", "/api/branches", {
            "name": "hbs-variant",
            "from_branch": "main",
            "expected_head": saved["head"],
        })
        self.assertEqual(status, 200)
        status, hbs_saved = self._request("POST", "/api/sequence", {
            "branch": "hbs-variant",
            "expected_head": saved["head"],
            "substitutions": [{"position": 7, "reference": "E", "alternate": "V"}],
            "message": "Propose E7V sickle variant",
        })
        self.assertEqual(status, 200)

        # 3. GET /api/ci/status?branch=hbs-variant evaluates the actual branch substitutions!
        status, ci_status = self._request("GET", "/api/ci/status?branch=hbs-variant")
        self.assertEqual(status, 200)
        self.assertEqual(ci_status["genotype"]["allele_id"], "HbS")
        self.assertFalse(ci_status["verdict"]["merge_allowed"])
        self.assertTrue(ci_status["verdict"]["disagreed_with_assay"])

        # 4. GET /api/ci/merge-gate checks mergeability of hbs-variant into main
        status, gate = self._request("GET", "/api/ci/merge-gate?target_branch=main&source_branch=hbs-variant")
        self.assertEqual(status, 200)
        self.assertEqual(gate["gate_status"], "failed_ci")
        self.assertFalse(gate["merge_allowed"])

        # 5. POST /api/sequence/merge with enforce_ci_gate=True rejects merging failing branch
        status, merge_err = self._request("POST", "/api/sequence/merge", {
            "target_branch": "main",
            "source_branch": "hbs-variant",
            "expected_target_head": saved["head"],
            "expected_source_head": hbs_saved["head"],
            "confirmed": True,
            "enforce_ci_gate": True,
            "message": "Attempt gated merge of unrescued HbS",
        })
        self.assertEqual(status, 409)
        self.assertIn("Multi-Agent CI Merge Gate blocked combine", merge_err["error"])

        # 6. POST /api/ci/cellsim returns live snapshot metrics
        status, sim = self._request("POST", "/api/ci/cellsim", {
            "polymerization_tendency": 0.9,
            "pO2": 15.0,
            "seed": 42,
        })
        self.assertEqual(status, 200)
        self.assertIn("snapshot", sim)
        self.assertGreater(sim["sickled_fraction"], 0.3)


if __name__ == "__main__":
    unittest.main()
