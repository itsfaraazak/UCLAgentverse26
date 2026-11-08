"""ComplianceAgent: the structural safety gate.

Per the hackathon builder guide's explicit rule ("keep people in control
whenever an action affects... clinical care") and the track's separately
judged compliance/safety criterion, this agent -- not a prompt, not a
convention -- is what decides whether a classification may finalize
automatically or must wait on a human. The rule is simple and auditable:
a classification that merely agrees with (or has nothing to disagree
with) the existing record proceeds automatically; a classification that
*disagrees* with an existing record *and* crosses the actionable
Pathogenic/Uncertain line (the exact pattern documented as clinically
dangerous in the literature -- see conflict_agent.py) is blocked behind
a physical sign-off gate (see hardware/__init__.py) until a human
approves it.

Tests inject a fake gate by monkeypatching `get_gate` on this module --
they never need the real hardware or its software simulator to be
present.
"""
from __future__ import annotations

from ..hardware import get_gate
from .base import Agent


class ComplianceAgent(Agent):
    name = "compliance_agent"

    def run(self, gene: str, variant_id: str, conflict_delta_id: str):
        conflict_delta = self.dag.get(conflict_delta_id)
        payload = conflict_delta.payload
        subject = f"{gene}:{variant_id}"
        must_block = payload["conflict"] and payload["crosses_actionable_threshold"]

        if not must_block:
            gate_delta = self.emit(
                "gate",
                subject,
                {
                    "blocked": False,
                    "reason": "No actionable disagreement -- clean first-pass classification.",
                    "required_role": "none",
                    "hardware_armed": False,
                },
                parents=(conflict_delta_id,),
            )
            signoff_delta = self.emit(
                "signoff",
                subject,
                {
                    "approved": True,
                    "signer": "auto",
                    "role": "none",
                    "note": "Auto-approved: nothing clinically actionable to review.",
                    "via": "software",
                },
                parents=(gate_delta.id,),
            )
            return gate_delta, signoff_delta

        reason = (
            f"{gene} {variant_id}: new call "
            f"{payload['new_classification']!r} disagrees with prior "
            f"{payload['prior_classification']!r} and crosses the "
            "actionable Pathogenic/Uncertain line. Genetic-counselor "
            "sign-off required before this classification can be used "
            "for any treatment-pathway decision."
        )
        gate_delta = self.emit(
            "gate",
            subject,
            {
                "blocked": True,
                "reason": reason,
                "required_role": "genetic_counselor",
                "hardware_armed": True,
            },
            parents=(conflict_delta_id,),
        )

        gate = get_gate()
        gate.arm(reason=reason)
        approved = gate.wait_for_signoff(timeout=120)
        if approved:
            gate.clear()
        via = "hardware" if type(gate).__name__ == "HardwareSignOffGate" else "software"

        signoff_delta = self.emit(
            "signoff",
            subject,
            {
                "approved": approved,
                "signer": "demo-operator",
                "role": "genetic_counselor",
                "note": (
                    "Human reviewed and approved the reclassification."
                    if approved
                    else "No approval received before timeout -- classification stays blocked."
                ),
                "via": via,
            },
            parents=(gate_delta.id,),
        )
        return gate_delta, signoff_delta
