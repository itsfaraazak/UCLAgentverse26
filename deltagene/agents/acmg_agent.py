"""AcmgScoringAgent: deterministic ACMG/AMP 2015 variant classification,
using the point values from Tavtigian et al. 2018's Bayesian point-based
refinement of the ACMG/AMP guidelines (Genet Med 20:1054-1060). This is
plain rule-based Python -- no LLM call, no hallucination risk -- because
that is what the hackathon's "deterministic verification loop"
requirement and the "science and evaluation" judging criterion ask for.

Criteria implemented (a deliberately small, demo-scoped subset of the
full ~28-criterion ACMG/AMP framework):
  PVS1  null variant in a gene where LoF is a known disease mechanism  +8
  PS1*  matches an established pathogenic amino-acid change            +4
  PM2   absent/rare in population databases (freq < 0.0005)            +2
  PP3   computational evidence supports a deleterious effect (>=0.7)   +1
  PP1*  co-segregates with disease in affected relatives               +1
  BA1   stand-alone benign: population frequency > 0.05         -> forces "Benign"
  BS1*  frequency higher than expected for the disorder (0.01-0.05)    -4
  BP4   computational evidence suggests a benign effect (<0.3)         -1
(* label kept close to, but not a strict rename of, the official code --
  PS1/BS1/PP1 are normally about specific orthogonal evidence lines;
  here they're approximated by the single available input field for
  demo purposes. See README.md for this caveat.)

Classification bands (Tavtigian et al. 2018, Table 2 points -> category):
  >=10          Pathogenic
  6-9           Likely Pathogenic
  -5 to 5       Uncertain Significance
  -9 to -6      Likely Benign
  <=-10         Benign
"""
from __future__ import annotations

import json
from pathlib import Path

from .base import Agent

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "sample_variants.json"


def _load_variant(gene: str, variant_id: str) -> dict:
    with open(_DATA_PATH) as f:
        data = json.load(f)
    for record in data["variants"]:
        if record["gene"] == gene and record["variant_id"] == variant_id:
            return record
    raise KeyError(f"no fixture for {gene}:{variant_id}")


def score_acmg(acmg_inputs: dict) -> tuple[str, int, list[dict]]:
    """Pure function: (classification, points, criteria_trail). Exposed
    standalone so it can be unit-tested without the Delta/DAG machinery."""
    freq = acmg_inputs["population_frequency"]
    criteria: list[dict] = []
    points = 0

    def mark(code: str, met: bool, weight: int, note: str):
        nonlocal points
        if met:
            points += weight
        criteria.append({"code": code, "met": met, "weight": weight if met else 0, "note": note})

    mark(
        "PVS1",
        acmg_inputs["is_null_variant_in_lof_gene"],
        8,
        "Null variant in a gene where loss-of-function is a known disease mechanism.",
    )
    mark(
        "PS1",
        acmg_inputs["matches_known_pathogenic_aa_change"],
        4,
        "Matches an established pathogenic amino-acid change.",
    )
    mark(
        "PM2",
        freq < 0.0005,
        2,
        f"Absent/rare in population databases (freq={freq} < 0.0005).",
    )
    mark(
        "PP3",
        acmg_inputs["in_silico_deleterious_score"] >= 0.7,
        1,
        "Computational evidence supports a deleterious effect (score >= 0.7).",
    )
    mark(
        "PP1",
        acmg_inputs["segregates_with_disease"],
        1,
        "Co-segregates with disease in affected relatives.",
    )

    ba1 = freq > 0.05
    criteria.append(
        {
            "code": "BA1",
            "met": ba1,
            "weight": 0,
            "note": f"Stand-alone benign: freq={freq} > 0.05 "
            + ("(OVERRIDES all other evidence -> Benign)." if ba1 else "(not met)."),
        }
    )

    mark(
        "BS1",
        0.01 < freq <= 0.05,
        -4,
        f"Frequency higher than expected for the disorder (0.01 < freq={freq} <= 0.05).",
    )
    mark(
        "BP4",
        acmg_inputs["in_silico_deleterious_score"] < 0.3,
        -1,
        "Computational evidence suggests a benign effect (score < 0.3).",
    )

    if ba1:
        classification = "Benign"
    elif points >= 10:
        classification = "Pathogenic"
    elif 6 <= points <= 9:
        classification = "Likely Pathogenic"
    elif -5 <= points <= 5:
        classification = "Uncertain Significance"
    elif -9 <= points <= -6:
        classification = "Likely Benign"
    else:
        classification = "Benign"

    return classification, points, criteria


class AcmgScoringAgent(Agent):
    name = "acmg_agent"

    def run(self, gene: str, variant_id: str, parent_evidence_delta_id: str):
        record = _load_variant(gene, variant_id)
        classification, points, criteria = score_acmg(record["acmg_inputs"])
        subject = f"{gene}:{variant_id}"
        payload = {
            "gene": gene,
            "variant_id": variant_id,
            "classification": classification,
            "points": points,
            "criteria": criteria,
        }
        return self.emit("classification", subject, payload, parents=(parent_evidence_delta_id,))
