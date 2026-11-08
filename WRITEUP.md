# EditVerse — hackathon prototype

**Problem and user.** Gene-editing researchers must review evidence and
uncertainty collaboratively. This prototype explores a shared research-review
workspace, inspired by Delta, not a production genetic-design platform.

**Demonstration.** Two browsers share a bounded prompt draft. Scripted mode uses
predefined statements; an optional live Gemini workflow generates bounded
research claims and a model review. Two content-addressed branches can be
compared and merged with explicit conflict resolution. Comments attach to
artifact fields, and a single local decision identifies the current artifact hash
and workspace version. Approval requires passing structural checks and resolved
merge conflicts; requesting changes does not. SQLite and
JSON export retain the workspace. A changed draft or new run invalidates the
previous decision. Only fixed categories, not the draft, go to the provider.

**Data.** The example is a fictional teaching scenario and uses no patient
data. Its source links include public research papers and governance reports.
Short curated summaries of two peer-reviewed papers and their limitations are
supplied to the live investigators and reviewer; they are based on public
Europe PMC abstract records, not live retrieval or a systematic review. The app
does not redistribute the papers or claim a benchmark dataset. Source identifiers
and model review do not establish support for every claim.

**Evaluation and baseline.** Run `python evaluation.py` and
`python -m unittest discover -s tests` from the repository root. The evaluation
uses ten hand-authored, synthetic artifacts with independently specified labels
for each documented structural rule: nonempty claims with a nonempty reference
list for each, and exact, case-sensitive claim-text uniqueness. Positive means
both rules pass. The baseline accepts any artifact with at least one claim.

| Method | True positive | True negative | False positive | False negative | Correct |
| --- | ---: | ---: | ---: | ---: | ---: |
| Structural checks | 4 | 6 | 0 | 0 | 10/10 |
| Nonempty-claims baseline | 4 | 1 | 5 | 0 | 5/10 |

These deliberately constructed cases exercise the rules, not a sample of real
reviews; the score is sensitive to case selection and is not an effectiveness
estimate. Case and whitespace variants pass the exact-duplicate rule. Unknown
source IDs and unsupported assertions can also pass these artifact checks.
Separate model-output validation checks fixture IDs but does not verify support.
Tests additionally exercise selected rejected draft inputs and, with a stubbed
provider, that the original draft is absent from prompts. These examples do not
establish comprehensive security, privacy, or prompt-injection resistance.
Other tests cover the API, draft conflicts, stale reviews, malformed model
responses, and the scripted pipeline. No real researcher workflow comparison,
biology expert validation, source verification, or live-model evaluation has
been performed.

**Limits and safeguards.** Only the listed vocabulary and fixture are
supported. This is not an experiment design, treatment recommendation, cell
simulator, or clinical tool. A passing check establishes only the named
syntactic/coverage rule, not factual correctness or safety. There is no
authentication, real-time character-level co-editing,
comprehensive privacy protection, or production security assessment. Keep
all patient data and sensitive material out. A human decision is a review
record, not permission to perform an experiment.
