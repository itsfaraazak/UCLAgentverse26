"""Compliance-agent tests inject a fake gate by monkeypatching
`get_gate` on the compliance_agent module directly -- they never touch
the real hardware bridge or its software simulator, so they stay valid
no matter how that half of the system is implemented.
"""
from deltagene.agents import compliance_agent as compliance_agent_module
from deltagene.agents.acmg_agent import AcmgScoringAgent
from deltagene.agents.compliance_agent import ComplianceAgent
from deltagene.agents.conflict_agent import ConflictAgent
from deltagene.agents.evidence_agent import EvidenceAgent
from deltagene.delta_dag import DeltaDAG

HBB = ("HBB", "NM_000518.5(HBB):c.20A>T (p.Glu7Val)")
DEMO1 = ("DEMO1", "SYN:DEMO1:c.100C>T (p.Arg34Cys)")


class _FakeGate:
    def __init__(self, approve: bool):
        self._approve = approve
        self.armed_reason = None
        self.cleared = False

    def arm(self, reason: str) -> None:
        self.armed_reason = reason

    def wait_for_signoff(self, timeout=None) -> bool:
        return self._approve

    def clear(self) -> None:
        self.cleared = True


def _conflict_delta(dag, gene, variant_id):
    evidence = EvidenceAgent(dag).run(gene, variant_id)
    classification = AcmgScoringAgent(dag).run(gene, variant_id, evidence.id)
    return ConflictAgent(dag).run(gene, variant_id, classification.id)


def test_clean_case_auto_approves_without_touching_the_gate(monkeypatch):
    calls = []
    monkeypatch.setattr(
        compliance_agent_module,
        "get_gate",
        lambda *a, **k: calls.append("called") or _FakeGate(approve=True),
    )
    dag = DeltaDAG()
    conflict = _conflict_delta(dag, *HBB)
    gate_delta, signoff_delta = ComplianceAgent(dag).run(*HBB, conflict.id)

    assert calls == []  # hardware/simulator never invoked for a clean case
    assert gate_delta.payload["blocked"] is False
    assert signoff_delta.payload["approved"] is True
    assert signoff_delta.payload["signer"] == "auto"


def test_conflicting_case_blocks_then_signs_off_on_approval(monkeypatch):
    fake = _FakeGate(approve=True)
    monkeypatch.setattr(compliance_agent_module, "get_gate", lambda *a, **k: fake)

    dag = DeltaDAG()
    conflict = _conflict_delta(dag, *DEMO1)
    gate_delta, signoff_delta = ComplianceAgent(dag).run(*DEMO1, conflict.id)

    assert gate_delta.payload["blocked"] is True
    assert gate_delta.payload["required_role"] == "genetic_counselor"
    assert fake.armed_reason is not None
    assert fake.cleared is True
    assert signoff_delta.payload["approved"] is True
    assert signoff_delta.payload["role"] == "genetic_counselor"


def test_conflicting_case_stays_blocked_on_denial(monkeypatch):
    fake = _FakeGate(approve=False)
    monkeypatch.setattr(compliance_agent_module, "get_gate", lambda *a, **k: fake)

    dag = DeltaDAG()
    conflict = _conflict_delta(dag, *DEMO1)
    _, signoff_delta = ComplianceAgent(dag).run(*DEMO1, conflict.id)

    assert signoff_delta.payload["approved"] is False
    assert fake.cleared is False
