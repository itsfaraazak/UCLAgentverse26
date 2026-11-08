# HBB sequence API

The fixed
public reference is [UniProtKB P68871](https://www.uniprot.org/uniprotkb/P68871/entry),
sequence version 2, 147 amino acids. Positions are 1-based on the full sequence
including the initiator methionine. Mature-chain numbering may differ by one.

- `GET /api/sequence` returns `head`, `reference` (accession, sequence_version,
  source_url, sequence), the proposed `sequence`, `substitutions`, a
  `disclaimer`, and up to 50 entries of shared Git `history`.
- `POST /api/sequence` accepts exactly `{"expected_head": null,
  "substitutions": [{"position": 7, "reference": "E", "alternate": "V"}]}`.
  Set `expected_head` to the last loaded full Git ID, or null for an empty
  history. The list replaces all proposed substitutions, always relative to
  the fixed reference, not the previous proposal. Use an empty list to revert.
  Each position must be unique, each reference must match, and both residues
  must be uppercase standard one-letter amino-acid codes. A no-op is rejected.
  Additional fields, including patient information, are rejected.
- `GET /api/sequence/diff?commit=<full Git ID>` returns `commit` and a Git
  `diff` limited to `sequence.json`. Only the latest 50 history commits are
  addressable. Note-only commits, including old commits, have empty sequence
  diffs; they are not sequence edits.
- `GET /api/compare?from=<full Git ID>&to=<full Git ID>` compares two commits
  in the given direction. Both IDs must be lowercase, full object IDs for
  commits reachable from the captured `main` head, including commits older than
  the 50-entry history display. Revision expressions, abbreviated IDs, other
  object types and unreachable commits are rejected. Exactly one `from` and
  one `to` parameter are required; a synthetic reference ID is not supported.
  The response shape is:

  ```json
  {
    "from": {"commit": "...", "sequence": {"reference": {}, "sequence": "...", "substitutions": [], "disclaimer": "..."}, "note": "..."},
    "to": {"commit": "...", "sequence": {"reference": {}, "sequence": "...", "substitutions": [], "disclaimer": "..."}, "note": "..."},
    "sequence": {"diff": "...", "changes": [{"position": 7, "old": "E", "new": "V"}]},
    "notes": {"diff": "..."}
  }
  ```

  Each nested `sequence` is the complete state in the same format as
  `GET /api/sequence`, excluding `head` and `history`. Commits before
  `sequence.json` existed resolve to the canonical reference state. `changes`
  compares the two actual sequences, sorted by 1-based position, so it includes
  reversals and changes between alternate residues. The two `diff` strings are
  actual Git patches, restricted to `sequence.json` and `note.md` respectively;
  a missing sequence file is not synthesized in the Git patch. Identical or
  note-only sequence states have no semantic changes, even if serialized
  metadata differs. Note text is returned only in the separate note fields and
  notes patch; callers must not send it to a model. Comparison is read-only.

Notes and sequence share the existing app-owned Git main branch and optimistic
concurrency head. Either kind of write can cause the other to return HTTP 409;
reload before retrying. Input errors return 400, storage failures 503. The
sequence is a proposed in-silico text substitution, **not** a measured or
predicted 3D structure and **not for clinical use**. The viewer's existing
structure does not change. Do not enter sensitive information into the notes.
