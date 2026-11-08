# EditVerse

An agent-assisted research workspace for proposing **human HBB protein**
sequence changes, comparing versions and restoring earlier states. It is a
research prototype, **not a clinical product**, genome editor, or experimental
design tool. Do not enter patient information, private sequences, credentials,
or any other sensitive information.

## Run locally

Requires Python 3.9+, Git, and a WebGL-capable browser. The agent requires
internet access and a Gemini API key in the server environment:

```sh
export GEMINI_API_KEY='your-key-here'
python3 backend/server.py
```

Supply your own key locally; never put it in the repository, browser, or chat.
Without it, manual editing and comparisons work but agent requests report that
the model is not configured. The configured provider is Google Gemini 4 Argon,
not GPT-6.

```sh
python3 backend/server.py
```

Open **http://127.0.0.1:8000**. The server is unauthenticated and binds to
localhost only; do not expose it to a network. Stop any older server process
before restarting after code changes.

## Use the workspace

1. Describe an HBB research goal to the agent. It may answer directly, ask a
   clarifying question, search Europe PMC for abstracts, compare the latest
   saved version with its parent, or propose a sequence change. A model-selected
   change is an unverified hypothesis, not a
   validated outcome. Review it, enter a commit message, and approve it; the
   agent cannot commit without approval. You can also edit manually.
2. Create or select a branch in the branch controls. Work is saved to that
   branch; a stale commit is rejected rather than overwriting a newer version.
3. In **History**, select two versions or the fixed reference baseline.
   Changed residues are shown in red and green; select a site to locate its
   deposited counterpart in the side-by-side 3D view. The red old and green
   new labels are annotations on the same reference coordinates, not a
   predicted structural change. Raw sequence and version differences remain
   available.
4. To roll back, select a historical commit and restore its sequence with a
   message. Restore creates a **new** commit; it does not erase intervening
   history or change historical notes. Branches require an initial commit.
5. To combine branches, select another branch in **History** and preview the
   resulting sequence. Confirming creates a version on the active branch.
   Conflicting changes at the same residue must be resolved before combining;
   the active branch's existing notes are preserved. If the source contains
   different historical note changes, combining is blocked rather than
   silently discarding them.

Sending a message initiates external processing and sends the conversation
and the current sequence to Google Gemini. If the agent searches, its
model-generated search terms are sent to Europe PMC. Notes and full history
are not sent.
Do not send patient or other sensitive information; the application cannot
reliably detect it. Model output is unverified and source links are context,
not proof of individual claims. Retrieved abstracts and model interpretations
are not independently validated, nor is the search a systematic review. Gemini
may reject a request or return output the application
cannot validate; there is no scripted fallback. Model provider retention and
terms are governed by the provider.

The structures are [RCSB PDB 2HHB](https://www.rcsb.org/structure/2HHB) and
[2HBS](https://www.rcsb.org/structure/2HBS), independently determined human
deoxyhemoglobin A and S. These are separate experimental models, not
before-and-after measurements of the same molecule. They are **not** models
generated from user edits, editing simulations, or evidence of safety or
efficacy. See [viewer provenance and licences](web/MOLECULE.md).

The **Predict the saved sequence** action submits the selected saved
147-residue protein sequence to the configured ESMFold provider; it does not
send notes or history. The default is ESM Metagenomic Atlas. To use the
authenticated Modal worker instead, deploy [the worker](esmfold_modal/README.md),
install `uv`, authenticate Modal locally, and start the server with
`EDITVERSE_FOLD_PROVIDER=modal`. Modal GPU calls can incur charges. By default,
select the button to send a snapshot; explicitly setting
`EDITVERSE_FOLD_AUTOMATIC=1` with the Modal provider automatically sends saved
sequences and selected comparisons for prediction, including on page load.
That can incur recurring charges. The app displays the configured provider and
automatic mode. Review provider retention and usage policies; do not submit
patient-derived or sensitive sequences. Its
single-chain computational prediction is not an experimental structure, a
model of the whole hemoglobin complex, or evidence of biological function,
clinical safety, or efficacy. Predictions are associated with the saved
sequence version and are not a measurement of the effect of an edit.
The hosted service has no verified availability guarantee and may time out,
including for sequences of this length; a successful prediction for one
sequence does not establish availability for another.

In History, selecting two versions and choosing **Send both sequences and
predict with ESMFold** requests separate predictions for those exact sequences.
The provider receives both sequences; notes and history remain local. The
models are not aligned and are not experimental measurements: differences in
their views do not establish the structural or functional effect of an edit.
The experimental reference context below them uses the same deposited
coordinates on both sides and marks sequence differences only.

Historical notes and proposed sequences are stored in an app-owned bare Git repository,
`research-notes.git/` by default; `GIT_HISTORY_PATH` can point to another
dedicated path whose parent exists. Git must be installed. Do not use an
existing repository as this path. Saves use the last loaded head and reject
stale updates. Files are unencrypted. The interface shows the 50 most recent
commits on the active branch. Git is an internal storage mechanism; there is
no GitHub integration, authenticated network collaboration, or remote sync.

## Scope and limitations

- Sequence substitutions are hypothetical string edits, not evidence of
  function. Optional ESMFold predictions are unvalidated computational models.
  The research agent uses a bounded abstract
  search and does not validate model claims or independently verify the
  scientific literature or the effects of model-proposed edits. Approval
  commits a sequence representation, not a scientific
  review or clinical sign-off.
- The older synthetic agent pipeline remains in the backend for its existing
  tests; it is separate from this interface and is not evidence that the new
  workflow uses a live model.
- Real source data and an interactive structure do not establish medical
  correctness, clinical readiness, or usefulness. No clinician validation or
  real-world performance evaluation has been conducted.
- There is no authentication, encryption, access control, or network deployment
  protection. See [SECURITY.md](SECURITY.md).

## Checks

```sh
STORE_DB_PATH=:memory: python3 -m unittest discover -s tests
node --check web/app.js
node tests/test_molecule.js
node tests/test_diff_molecule.js
node tests/test_frontend_compare.js
node tests/test_agent_workspace.js
node tests/test_sequence_diff.js
node tests/test_fold_prediction.js
node tests/test_prediction_compare.js
node tests/test_prediction_priority.js
```

Tests include mocked source failures, real Git objects and diffs, local HTTP
boundaries, and viewer integration mocks. They are not clinical validation and
the viewer mocks do not replace a real WebGL browser check.
