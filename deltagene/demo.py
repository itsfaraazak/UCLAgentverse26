"""Live-demo CLI: runs all three sample variants through the DeltaGene
pipeline and prints the full Delta trail for each, so a judge can watch
evidence -> classification -> conflict -> compliance gate -> (human
sign-off) -> treatment match happen end to end.

Usage:
    python3 -m deltagene.demo                 # interactive sign-off
    DELTAGENE_AUTO_APPROVE=1 python3 -m deltagene.demo   # non-interactive
"""
from __future__ import annotations

import json
from pathlib import Path

from .orchestrator import DeltaGenePipeline

DATA_PATH = Path(__file__).parent / "data" / "sample_variants.json"


def _print_delta(dag, delta_id: str, label: str) -> None:
    delta = dag.get(delta_id)
    print(f"\n  [{label}] {delta.kind} delta `{delta.id}` by {delta.author}")
    print(f"    {json.dumps(delta.payload, indent=4)}")


def main() -> None:
    variants = json.loads(DATA_PATH.read_text())["variants"]
    pipeline = DeltaGenePipeline()

    for v in variants:
        print("\n" + "=" * 72)
        print(f"Variant: {v['gene']} {v['variant_id']}  [{v['label']}]")
        print(f"  {v['note']}")
        result = pipeline.run(v["gene"], v["variant_id"])

        _print_delta(pipeline.dag, result.evidence_delta_id, "1. evidence")
        _print_delta(pipeline.dag, result.classification_delta_id, "2. classification")
        _print_delta(pipeline.dag, result.conflict_delta_id, "3. conflict")
        _print_delta(pipeline.dag, result.gate_delta_id, "4. compliance gate")
        _print_delta(pipeline.dag, result.signoff_delta_id, "5. sign-off")
        if result.therapy_delta_id:
            _print_delta(pipeline.dag, result.therapy_delta_id, "6. treatment match")
        else:
            print("\n  [6. treatment match] skipped (not approved, or no therapy on file)")

    print("\n" + "=" * 72)
    print(f"Done. {len(pipeline.dag.all())} deltas recorded across {len(variants)} variants.")
    print("Every number above traces back through its `parents` chain to the evidence that produced it.")


if __name__ == "__main__":
    main()
