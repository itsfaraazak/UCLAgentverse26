"""Shared agent contract and the exact Delta payload shapes each kind uses.

Every agent subclasses `Agent`, takes a `DeltaDAG` in its constructor, and
exposes a `run(...)` method that returns the new `Delta` it produced (or
a list of Deltas, for an agent that must emit more than one claim).
Agents must not special-case each other's internals -- they only read
Deltas of the kinds they declare an interest in and write Deltas of the
kind they own. That is what makes this a real multi-agent pipeline
instead of one function split into files.

Payload shapes (the contract between agents)
----------------------------------------------
kind="evidence"        {"gene": str, "variant_id": str,
                         "citations": [{"source": str, "id": str,
                                        "summary": str, "url": str}],
                         "synthetic": bool}
kind="classification"  {"gene": str, "variant_id": str,
                         "classification": "Pathogenic"|"Likely Pathogenic"
                                            |"Uncertain Significance"
                                            |"Likely Benign"|"Benign",
                         "points": int,
                         "criteria": [{"code": str, "met": bool,
                                        "weight": int, "note": str}]}
kind="conflict"        {"gene": str, "variant_id": str, "conflict": bool,
                         "prior_classification": str | None,
                         "new_classification": str,
                         "crosses_actionable_threshold": bool, "note": str}
kind="gate"            {"blocked": bool, "reason": str,
                         "required_role": str, "hardware_armed": bool}
kind="signoff"         {"approved": bool, "signer": str, "role": str,
                         "note": str, "via": "hardware"|"software"}
kind="therapy_match"   {"gene": str, "variant_id": str,
                         "therapies": [{"name": str, "approved_for": str,
                                         "mechanism": str, "citation": str}]}

Every payload also implicitly carries provenance through the Delta's own
`author`, `parents`, and `created_at` fields -- agents should not
duplicate those inside the payload.
"""
from __future__ import annotations

from ..delta_dag import Delta, DeltaDAG


class Agent:
    """Base class for all DeltaGene agents."""

    #: Short, stable name used as `Delta.author` for everything this
    #: agent writes. Override in subclasses.
    name: str = "agent"

    def __init__(self, dag: DeltaDAG):
        self.dag = dag

    def emit(
        self,
        kind: str,
        subject: str,
        payload: dict,
        parents: tuple[str, ...] | list[str] = (),
    ) -> Delta:
        """Convenience wrapper: build a Delta authored by this agent and
        add it to the shared DAG in one call."""
        delta = Delta.new(
            kind=kind,  # type: ignore[arg-type]
            author=self.name,
            subject=subject,
            payload=payload,
            parents=parents,
        )
        return self.dag.add(delta)

    def run(self, *args, **kwargs):
        raise NotImplementedError
