"""ConflictAgent: detects disagreement between a freshly computed
classification and whatever classification was already on record for
the same variant.

This models the real, documented failure mode in clinical genomics: labs
submitting independently to ClinVar frequently disagree on the same
variant (e.g. Oliver et al. 2020 found 47.4% of shared epilepsy-gene
ClinVar variants had *some* conflicting interpretation, and 3.2% were
"clinically substantial" -- crossing the Uncertain-Significance line;
the SHaRe hypertrophic-cardiomyopathy consortium found 45.2% discordance
among ordinary clinical labs). We simulate the "already on record" call
via each fixture's `prior_classification` field rather than a live
ClinVar query, consistent with this being a synthetic/public-reference
demo (see data/sample_variants.json).
"""
from __future__ import annotations

import json
from pathlib import Path

from .base import Agent

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "sample_variants.json"

_ACTIONABLE = {"Pathogenic", "Likely Pathogenic"}
_NON_ACTIONABLE = {"Uncertain Significance", "Likely Benign", "Benign"}


def _load_variant(gene: str, variant_id: str) -> dict:
    with open(_DATA_PATH) as f:
        data = json.load(f)
    for record in data["variants"]:
        if record["gene"] == gene and record["variant_id"] == variant_id:
            return record
    raise KeyError(f"no fixture for {gene}:{variant_id}")


def crosses_actionable_threshold(prior: str | None, new: str) -> bool:
    if prior is None:
        return False
    prior_side = prior in _ACTIONABLE
    new_side = new in _ACTIONABLE
    return prior_side != new_side


class ConflictAgent(Agent):
    name = "conflict_agent"

    def run(self, gene: str, variant_id: str, classification_delta_id: str):
        record = _load_variant(gene, variant_id)
        classification_delta = self.dag.get(classification_delta_id)
        new_classification = classification_delta.payload["classification"]
        prior = record.get("prior_classification")

        conflict = prior is not None and prior != new_classification
        threshold_crossed = crosses_actionable_threshold(prior, new_classification)

        note = (
            "No prior classification on record -- nothing to disagree with."
            if prior is None
            else (
                f"Agrees with prior call ({prior!r})."
                if not conflict
                else (
                    f"Disagrees with prior call ({prior!r} -> {new_classification!r}); "
                    + (
                        "crosses the actionable Pathogenic/Uncertain line -- treatment "
                        "decisions could change."
                        if threshold_crossed
                        else "stays on the same side of the actionable line."
                    )
                )
            )
        )

        subject = f"{gene}:{variant_id}"
        payload = {
            "gene": gene,
            "variant_id": variant_id,
            "conflict": conflict,
            "prior_classification": prior,
            "new_classification": new_classification,
            "crosses_actionable_threshold": threshold_crossed,
            "note": note,
        }
        return self.emit("conflict", subject, payload, parents=(classification_delta_id,))
