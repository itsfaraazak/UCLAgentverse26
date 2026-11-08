"""Wires the five DeltaGene agents together through one shared DeltaDAG.

This is deliberately a thin, linear pipeline: Evidence -> ACMG scoring ->
Conflict detection -> Compliance gate (+ human sign-off) -> Treatment
pathway. Each step's output Delta id is passed as the next step's parent,
so the resulting DeltaDAG is a complete, replayable audit trail from raw
evidence to the final treatment match -- the thing a judge (or a real
genetic counselor) can actually check.
"""
from __future__ import annotations

import dataclasses

from .agents.acmg_agent import AcmgScoringAgent
from .agents.compliance_agent import ComplianceAgent
from .agents.conflict_agent import ConflictAgent
from .agents.evidence_agent import EvidenceAgent
from .agents.treatment_agent import TreatmentPathwayAgent
from .delta_dag import DeltaDAG


@dataclasses.dataclass
class PipelineResult:
    gene: str
    variant_id: str
    evidence_delta_id: str
    classification_delta_id: str
    conflict_delta_id: str
    gate_delta_id: str
    signoff_delta_id: str
    therapy_delta_id: str | None


class DeltaGenePipeline:
    def __init__(self, dag: DeltaDAG | None = None):
        self.dag = dag if dag is not None else DeltaDAG()
        self.evidence = EvidenceAgent(self.dag)
        self.acmg = AcmgScoringAgent(self.dag)
        self.conflict = ConflictAgent(self.dag)
        self.compliance = ComplianceAgent(self.dag)
        self.treatment = TreatmentPathwayAgent(self.dag)

    def run(self, gene: str, variant_id: str) -> PipelineResult:
        evidence_delta = self.evidence.run(gene, variant_id)
        classification_delta = self.acmg.run(gene, variant_id, evidence_delta.id)
        conflict_delta = self.conflict.run(gene, variant_id, classification_delta.id)
        gate_delta, signoff_delta = self.compliance.run(gene, variant_id, conflict_delta.id)

        therapy_delta_id = None
        if signoff_delta.payload.get("approved"):
            therapy_delta = self.treatment.run(gene, variant_id, signoff_delta.id)
            therapy_delta_id = therapy_delta.id if therapy_delta else None

        return PipelineResult(
            gene=gene,
            variant_id=variant_id,
            evidence_delta_id=evidence_delta.id,
            classification_delta_id=classification_delta.id,
            conflict_delta_id=conflict_delta.id,
            gate_delta_id=gate_delta.id,
            signoff_delta_id=signoff_delta.id,
            therapy_delta_id=therapy_delta_id,
        )
