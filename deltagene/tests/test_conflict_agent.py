from deltagene.agents.acmg_agent import AcmgScoringAgent
from deltagene.agents.conflict_agent import ConflictAgent, crosses_actionable_threshold
from deltagene.agents.evidence_agent import EvidenceAgent
from deltagene.delta_dag import DeltaDAG

HBB = ("HBB", "NM_000518.5(HBB):c.20A>T (p.Glu7Val)")
DEMO1 = ("DEMO1", "SYN:DEMO1:c.100C>T (p.Arg34Cys)")
DEMO2 = ("DEMO2", "SYN:DEMO2:c.55G>A (p.Val19Ile)")


def _conflict_for(gene, variant_id):
    dag = DeltaDAG()
    evidence = EvidenceAgent(dag).run(gene, variant_id)
    classification = AcmgScoringAgent(dag).run(gene, variant_id, evidence.id)
    return ConflictAgent(dag).run(gene, variant_id, classification.id)


def test_crosses_actionable_threshold_helper():
    assert crosses_actionable_threshold("Uncertain Significance", "Likely Pathogenic") is True
    assert crosses_actionable_threshold("Pathogenic", "Likely Pathogenic") is False
    assert crosses_actionable_threshold(None, "Pathogenic") is False
    assert crosses_actionable_threshold("Benign", "Likely Benign") is False


def test_hbb_has_no_prior_so_no_conflict():
    delta = _conflict_for(*HBB)
    assert delta.payload["conflict"] is False
    assert delta.payload["crosses_actionable_threshold"] is False


def test_demo1_disagrees_and_crosses_threshold():
    delta = _conflict_for(*DEMO1)
    assert delta.payload["prior_classification"] == "Uncertain Significance"
    assert delta.payload["new_classification"] == "Likely Pathogenic"
    assert delta.payload["conflict"] is True
    assert delta.payload["crosses_actionable_threshold"] is True


def test_demo2_has_no_prior_so_no_conflict():
    delta = _conflict_for(*DEMO2)
    assert delta.payload["conflict"] is False
