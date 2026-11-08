"""Private Modal function for single-chain, 147-residue HBB candidate folds."""

import json
from pathlib import Path

import modal

MODEL_ID = "facebook/esmfold_v1"
MODEL_REVISION = "75a3841ee059df2bf4d56688166c8fb459ddd97a"
AMINO_ACIDS = frozenset("ACDEFGHIKLMNPQRSTVWY")


def validate_sequence(sequence: str) -> str:
    """Accept one uppercase, unambiguous, 147-residue amino-acid sequence."""
    if not isinstance(sequence, str) or len(sequence) != 147 or not set(sequence) <= AMINO_ACIDS:
        raise ValueError("Expected exactly 147 uppercase standard amino-acid letters.")
    return sequence


image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.4.1",
        "transformers==4.44.2",
        "huggingface-hub==0.24.6",
        "numpy==1.26.4",
        "scipy==1.14.1",
        "accelerate==0.33.0",
    )
)
app = modal.App("hbb-esmfold", image=image)
_model = None


@app.function(
    gpu="A100-40GB",
    cpu=4,
    memory=32768,
    timeout=600,
    startup_timeout=600,
    max_containers=1,
    min_containers=0,
    scaledown_window=10,
    retries=0,
)
def fold_hbb(sequence: str) -> dict:
    """Return PDB and provenance; sequence is never intentionally logged."""
    global _model
    sequence = validate_sequence(sequence)
    import torch
    from transformers import EsmForProteinFolding

    if _model is None:
        _model = EsmForProteinFolding.from_pretrained(
            MODEL_ID, revision=MODEL_REVISION, low_cpu_mem_usage=True
        ).eval().cuda()
    with torch.inference_mode():
        output = _model.infer(sequence)
        # Transformers 4.44 returns pLDDT on a 0–1 scale; PDB convention
        # and our API expose it on the usual 0–100 scale.
        output["plddt"] = output.plddt * 100
        pdb = _model.output_to_pdb(output)[0]
        # The CA score is one per residue, not the mean over 37 atom slots.
        ca_plddt = output.plddt[0, :, 1].float().cpu().tolist()
    return {
        "pdb": pdb,
        "plddt_ca": ca_plddt,
        "mean_plddt_ca": sum(ca_plddt) / len(ca_plddt),
        "provenance": {
            "model": MODEL_ID,
            "revision": MODEL_REVISION,
            "implementation": "transformers.EsmForProteinFolding",
            "transformers": "4.44.2",
            "torch": "2.4.1",
            "recycles": "model default",
            "sequence_length": 147,
        },
    }


@app.local_entrypoint()
def main(sequence: str, output: str = "hbb-fold.json"):
    """Run once and write JSON locally; avoid passing private sequences via CLI."""
    validate_sequence(sequence)
    result = fold_hbb.remote(sequence)
    Path(output).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Prediction written to {output}")
