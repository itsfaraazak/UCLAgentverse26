from deltagene.agents.acmg_agent import AcmgScoringAgent, score_acmg
from deltagene.agents.evidence_agent import EvidenceAgent
from deltagene.delta_dag import DeltaDAG

HBB = ("HBB", "NM_000518.5(HBB):c.20A>T (p.Glu7Val)")
DEMO1 = ("DEMO1", "SYN:DEMO1:c.100C>T (p.Arg34Cys)")
DEMO2 = ("DEMO2", "SYN:DEMO2:c.55G>A (p.Val19Ile)")


def _classify(dag, gene, variant_id):
    evidence = EvidenceAgent(dag).run(gene, variant_id)
    classification = AcmgScoringAgent(dag).run(gene, variant_id, evidence.id)
    return classification


def test_score_acmg_pure_function_bands():
    # Strong pathogenic signal, no high frequency -> Likely Pathogenic band.
    classification, points, criteria = score_acmg(
        {
            "population_frequency": 0.0003,
            "is_null_variant_in_lof_gene": False,
            "matches_known_pathogenic_aa_change": True,
            "in_silico_deleterious_score": 0.9,
            "segregates_with_disease": True,
        }
    )
    assert classification == "Likely Pathogenic"
    assert points == 8
    codes = {c["code"] for c in criteria}
    assert {"PVS1", "PS1", "PM2", "PP3", "PP1", "BA1", "BS1", "BP4"} == codes

    # BA1 stand-alone overrides everything else to Benign.
    classification, points, _ = score_acmg(
        {
            "population_frequency": 0.08,
            "is_null_variant_in_lof_gene": True,
            "matches_known_pathogenic_aa_change": True,
            "in_silico_deleterious_score": 0.9,
            "segregates_with_disease": True,
        }
    )
    assert classification == "Benign"


def test_hbb_fixture_classifies_likely_pathogenic():
    dag = DeltaDAG()
    delta = _classify(dag, *HBB)
    assert delta.payload["classification"] == "Likely Pathogenic"
    assert delta.kind == "classification"
    assert delta.payload["points"] >= 6


def test_demo1_fixture_crosses_into_likely_pathogenic():
    dag = DeltaDAG()
    delta = _classify(dag, *DEMO1)
    assert delta.payload["classification"] == "Likely Pathogenic"


def test_demo2_fixture_is_benign_via_ba1():
    dag = DeltaDAG()
    delta = _classify(dag, *DEMO2)
    assert delta.payload["classification"] == "Benign"
    ba1 = next(c for c in delta.payload["criteria"] if c["code"] == "BA1")
    assert ba1["met"] is True
