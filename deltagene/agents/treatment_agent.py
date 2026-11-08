"""TreatmentPathwayAgent: the "why any of this matters to a patient"
step. Only runs once a classification has been signed off, and only
surfaces therapies that are real, regulator-approved, and on record for
the gene in question -- it never invents a therapy for a gene that
isn't in therapy_table.json.
"""
from __future__ import annotations

import json
from pathlib import Path

from .. import llm
from .base import Agent

_THERAPY_PATH = Path(__file__).resolve().parent.parent / "data" / "therapy_table.json"

_ACTIONABLE = {"Pathogenic", "Likely Pathogenic"}


def _load_therapies(gene: str) -> list[dict]:
    with open(_THERAPY_PATH) as f:
        data = json.load(f)
    return data["by_gene"].get(gene, [])


class TreatmentPathwayAgent(Agent):
    name = "treatment_agent"

    def run(self, gene: str, variant_id: str, signoff_delta_id: str):
        signoff_delta = self.dag.get(signoff_delta_id)
        subject = f"{gene}:{variant_id}"

        if not signoff_delta.payload.get("approved"):
            return self.emit(
                "therapy_match",
                subject,
                {
                    "gene": gene,
                    "variant_id": variant_id,
                    "therapies": [],
                    "note": "Not signed off -- no treatment-pathway lookup performed.",
                },
                parents=(signoff_delta_id,),
            )

        chain = self.dag.history(signoff_delta_id)
        classification_deltas = [d for d in chain if d.kind == "classification"]
        if not classification_deltas:
            raise ValueError(f"no classification delta found in history of {signoff_delta_id}")
        final_classification = classification_deltas[-1].payload["classification"]

        if final_classification not in _ACTIONABLE:
            therapies: list[dict] = []
            note = f"Classification is {final_classification!r} -- not actionable, no lookup performed."
        else:
            therapies = _load_therapies(gene)
            if therapies:
                prompt = (
                    f"In one plain-language sentence, explain why a confirmed "
                    f"{final_classification} classification of {variant_id} in {gene} "
                    f"matters for a patient's eligibility for {therapies[0]['name']}."
                )
                note = llm.generate(prompt, model=llm.MODEL_IDS["fast_subagent"])
            else:
                note = f"No approved therapy on record for {gene} in therapy_table.json."

        return self.emit(
            "therapy_match",
            subject,
            {
                "gene": gene,
                "variant_id": variant_id,
                "therapies": therapies,
                "note": note,
            },
            parents=(signoff_delta_id,),
        )
