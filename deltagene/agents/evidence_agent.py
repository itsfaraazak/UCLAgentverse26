"""EvidenceAgent: roots a research thread with the citations/notes known
about a variant, before any scoring happens.

Reads from the sample_variants.json fixture file rather than a live
ClinVar/PubMed API, because this is a hackathon demo running on
synthetic + public-reference data (see data/sample_variants.json's
"_disclaimer"). Swapping in real API calls later only touches this file.
"""
from __future__ import annotations

import json
from pathlib import Path

from .. import llm
from .base import Agent

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "sample_variants.json"


def _load_variant(gene: str, variant_id: str) -> dict:
    with open(_DATA_PATH) as f:
        data = json.load(f)
    for record in data["variants"]:
        if record["gene"] == gene and record["variant_id"] == variant_id:
            return record
    raise KeyError(f"no fixture for {gene}:{variant_id}")


class EvidenceAgent(Agent):
    name = "evidence_agent"

    def run(self, gene: str, variant_id: str):
        record = _load_variant(gene, variant_id)
        subject = f"{gene}:{variant_id}"
        synthetic = record["label"] != "public-reference"

        source = "synthetic-fixture" if synthetic else "public-reference"
        citations = [
            {
                "source": source,
                "id": record["id"],
                "summary": record.get("common_name", record["note"]),
                "url": "",
            },
            {
                "source": source,
                "id": f"{record['id']}-note",
                "summary": record["note"],
                "url": "",
            },
        ]

        summary_prompt = (
            "In one short paragraph, plainly explain the evidence known about "
            f"the variant {variant_id} in gene {gene}. Context notes: "
            f"{record['note']}"
        )
        narrative = llm.generate(summary_prompt, model=llm.MODEL_IDS["deep_research"])

        payload = {
            "gene": gene,
            "variant_id": variant_id,
            "citations": citations,
            "synthetic": synthetic,
            "narrative": narrative,
        }
        return self.emit("evidence", subject, payload, parents=())
