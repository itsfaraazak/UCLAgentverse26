# Standalone HBB-length ESMFold on Modal

This is independent of the application backend. It predicts a **single chain**
from any 147 standard uppercase amino-acid letters; it does not establish that
the input is actually HBB. Insertions, deletions, ambiguous residues, FASTA
headers and whitespace are rejected. No HTTP endpoint is created. Workspace
users able to invoke the deployed Modal function can submit sequences.

The model is `facebook/esmfold_v1`, pinned to Hugging Face revision
`75a3841ee059df2bf4d56688166c8fb459ddd97a`. The Transformers 4.44.2
implementation bundles its OpenFold-derived utilities: `infer(sequence)` builds
the correct residue indices, and `output_to_pdb(output)` converts atom14 to
atom37 and writes pLDDT into PDB B-factor columns. It is not the original
ESMFold/OpenFold CUDA build. It is a prediction of the isolated chain, not a
hemoglobin tetramer or heme-bound structure, and is not clinical evidence.
Confidence is not proof of correctness. See the [model card](https://huggingface.co/facebook/esmfold_v1)
and [pinned implementation](https://github.com/huggingface/transformers/blob/v4.44.2/src/transformers/models/esm/modeling_esmfold.py).

## Cost, privacy and limitations

The worker can be deployed to the configured Modal workspace. One A100-40GB container, 4 CPUs,
32 GiB memory, no warm containers, 10-second idle window, 600-second execution
and startup timeouts and no configured retries limit exposure but **do not enforce a $5
spend cap**. Startup, image builds, CPU/memory, download, idle time and repeated
calls can cost extra; timeout is not a precise billing cap. Check current
[pricing](https://modal.com/pricing), usage and workspace budget/spend controls
before one test; stop if remaining budget is insufficient. The ~16.9 GB
checkpoint is downloaded inside the GPU container on a cold start; download and
model loading are billed and may fail or timeout. No persistent volume or
cross-container model cache is configured; a warm container reuses its loaded
model. The public E7V example ran successfully on an A100-40GB; performance and
reliability for other sequences remain unverified.

Inputs and outputs leave the local machine for Modal; model files are downloaded
from Hugging Face. The code does not print the sequence or result, but Modal
infrastructure, logs, errors, local shell history and output files have their
own retention/access policies. Review those before submitting sensitive data.
CLI arguments can appear in shell history/process lists; use the public example
only for the CLI. Avoid using this for private sequences until an appropriate
secure input and retention policy is in place.

## Local checks and deployment

From the repository root, with Python 3.11 or a compatible local Modal client:

```sh
python3 -m unittest discover -s esmfold_modal -p 'test_*.py'
python3 -m venv .venv-esmfold
. .venv-esmfold/bin/activate
python -m pip install 'modal==1.6.3'
modal setup
modal deploy esmfold_modal/app.py
```

The setup and deploy commands require Modal credentials; do not put credentials
in this repository. Deployment creates no public web endpoint and does not
itself invoke inference. For a single public synthetic smoke test (147 alanines,
not a claim about real HBB), after reviewing the budget:

```sh
modal run esmfold_modal/app.py --sequence "$(python -c 'print("A"*147)')" --output hbb-fold.json
```

This starts a separate ephemeral Modal app and a billable inference; it does not
invoke the deployed app. The resulting local JSON contains `pdb` (PDB text),
`plddt_ca` (147 per-residue CA scores on the 0–100 scale), `mean_plddt_ca`
and `provenance` (model, immutable revision, implementation and versions,
default recycles, sequence length). PDB B-factors contain per-atom pLDDT, not
physical crystallographic B-factors. To call the deployed function from an
authenticated Modal client:

```python
import modal
fold = modal.Function.from_name("hbb-esmfold", "fold_hbb")
result = fold.remote("A" * 147)
```

Neither the JSON nor the PDB is intentionally printed by the function. These
files and returned data should be handled as sensitive if the sequence is
sensitive. Outputs are not stored in a Modal volume by this module.
