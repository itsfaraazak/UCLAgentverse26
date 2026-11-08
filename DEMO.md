# SigmaFold — demo script

**Audience:** a judge with four minutes and no patience for setup.
**Read before you run:** [`SPEC.md`](./SPEC.md) §7 (safety boundary) and §9 (definition of done).

---

## The problem, in three sentences

A pre-clinical researcher proposing a therapeutic gene edit has no CI.
The edit gets argued over in slide decks and lab notebooks, and nothing comes out the other
end that says *this exact change, against this exact reference, passed these exact checks,
with this audit trail.*
SigmaFold is that artifact: a branch, a diff, a seven-check pipeline, and a merge gate.

---

## Walkthrough

Six steps, mapping one-to-one onto SPEC §9. Run them in order — each one sets up the next.

### 1 — Gene track: show what is being edited

**Click:** open the app on the HBB locus. Zoom the gene track in to codon level.

**They should see:** an SVG track for *HBB* (chromosome 11) with its three exons, the modelled
region highlighted, and a marker on the edited codon. Exons 2 and 3 are greyed — context, not
modelled.

**Say:** the modelled region is **31 codons / 93 nt**, translating to
`MVHLTPEEKSAVTALWGKVNVDEVGGEALGR`.

> **Non-trivial because:** codon 31 straddles the exon 1 / exon 2 boundary, so the track has to
> render a region whose codon numbering and exon numbering disagree — and say which one each
> label means.

### 2 — Three-register diff: show the change

**Click:** switch from the `HbA / HbA` genotype to `HbS / HbS`. Keep all three diff registers
visible — **DNA**, **codon**, **amino acid**.

**They should see:** exactly one changed row. Codon **7**: `GAG` → `GTG`, **E → V**. Every
other row reads `same`.

**Say:** this is the textbook sickle substitution. The fixture carries both names —
`p.Glu7Val` in CDS numbering, legacy `Glu6Val` counting from the mature protein after the
initiator methionine is removed. Same substitution, two conventions.

**Then click:** the synthetic silent variant at codon **5**, `ACT` → `ACC`.

**They should see:** the DNA register changes, the amino-acid register does not. The row is
flagged `silent`.

> **Non-trivial because:** the diff is a codon-level global alignment (Needleman–Wunsch-style,
> scoring match `2` / mismatch `0` / gap `-1`), not a positional zip. A single-nucleotide
> change reports as one `changed` row rather than a `removed`+`added` pair, and a real indel
> shifts later rows instead of truncating the shorter sequence.

### 3 — Drop pO₂: watch the genotypes diverge

**Click:** the pO₂ slider. Drag it down from the default **95 mmHg** toward **10 mmHg**,
holding each genotype for a beat: `HbA / HbA`, then `HbS / HbS`, then `Post-repair`.

**They should see:** at high pO₂ the three look the same. Below roughly **60 mmHg** the sickle
genotype starts deforming, gains drag, and jams at the constriction; occlusion climbs and mean
flow drops. Wild-type and post-repair stay flowing.

**Say:** the genotype's `polymerizationTendency` is the only thing that differs —
**0.0** wild-type, **0.85** sickle, **0.05** post-repair. Point at the "illustrative model"
label on the panel while you say it.

> **Non-trivial because:** the simulation is seeded and headless (same seed ⇒ same metrics), so
> the number the audience sees on the canvas is the same number the assay agent reads in
> step 4. There is no second, prettier copy of the physics for the UI.

### 4 — Run the pipeline: seven checks, gate second

**Click:** *Run checks* on the proposed repair edit. Expand a check row to show its delta.

**They should see:** seven checks resolving in fixed order —

1. `IntentAgent`
2. **`BiosafetyGateAgent`** ← the gate
3. `EditPlannerAgent`
4. `StructuralImpactAgent`
5. `FunctionalAssayAgent`
6. `OffTargetRiskAgent`
7. `VerifierAgent`

and an append-only audit trail underneath: one attributed delta per agent, each naming its
parents.

**Say:** the gate is at **position 2** — before any structural or functional analysis runs.
Every agent is deterministic and LLM-free, so a judge can re-derive any verdict by hand.

> **Non-trivial because:** the verifier does not read the other agents' prose. It reads the
> measured simulation output, which is what lets it disagree with them (see *if a judge asks*).

### 5 — Red-team console: get blocked

**Click:** the red-team console. Type a request that trips the gate. Three worth showing, in
this order:

| Type this kind of thing | Verdict | Category |
|---|---|---|
| a request for guide / primer / vector / protocol detail | **block** | `CONSTRUCT_DESIGN_REQUEST` |
| disrupting a tumour suppressor, *with* a therapeutic justification attached | **block** | `TUMOUR_SUPPRESSOR_DISRUPTION` |
| the same HBB edit, but framed as heritable / embryo | **escalate** | `GERMLINE_HERITABLE` |

**They should see:** the run terminating at check 2 — checks 3–7 never execute. The panel
renders the **category and the generic policy reason only**. The request text is gone,
replaced by a 16-hex digest.

**Say:** two things. First, the tumour-suppressor refusal fires *independent of stated
purpose* — adding "therapeutic" to the sentence does not help. Second, nothing echoes the
refused request back: policy reasons are static strings that are never templated with user
input, and the test suite asserts a unique marker typed into a blocked request cannot be found
anywhere in the result object.

**Say also:** an `escalate` verdict blocks the merge and names a sign-off role
(`institutional_biosafety_committee` for heritable, `principal_investigator` for unjustified
multiplex). Nothing auto-approves an escalation.

> **Non-trivial because:** the gate's position is structural, not cosmetic. A `block` ends the
> run; it is not a disclaimer printed next to results that were computed anyway.

### 6 — Merge: get stopped

**Click:** the branch switcher. Take a branch whose head carries a failing or escalated check
and attempt to merge it into `main`.

**They should see:** the merge refused, with the failing check named. Then show the other
failure mode — two branches that edited the *same gene differently* — and the merge coming
back as a **conflict**, listing the gene and the three object ids (base / ours / theirs),
unresolved.

**Say:** oids are `sha256(canonicalJson(object))`, full 64 hex, first 12 shown. Keys are
sorted before hashing, so the same genotype produces the same id across runs and across
repository instances — point at two matching short oids on screen.

> **Non-trivial because:** nothing auto-resolves. A genotype that two people changed in two
> different ways is a conflict a human owns, exactly as in Git — the tool refuses to guess
> which allele wins.

---

## If a judge asks

**"Is the simulation real?"**
No, and deliberately not. It is a seeded 2D particle model of flow through a constriction,
tuned so the difference between genotypes reads clearly on a projector. It is not calibrated
against experimental haemorheology and must not be read as predictive. The panel says so
on screen. What *is* real is that it is deterministic and headless, so the assay agent and the
canvas see identical numbers.

**"Are the structural annotations model output?"**
No. They are curated textbook summaries carried in `src/data/loci.json`, each labelled
`confidence: textbook-consensus` or `synthetic`, each with its own `limitation` field. No
structure prediction runs anywhere in this repository.

**"Is the biosafety screen real security?"**
No. It is a **deterministic keyword-and-registry screen** — seven categories, eight registry
entries, a handful of lexical cues. It over-blocks on innocent phrasing and it can be evaded
by paraphrase. We chose it because a reviewer can read the file and re-derive every verdict by
hand, and that auditability is the demo. In any real setting it belongs *in front of* a human
biosafety officer, never in place of one.

**"Why Git? Isn't that just a metaphor?"**
It is a load-bearing one. The thing missing from edit review is not more analysis — it is an
*identity* for a proposal. Content addressing gives a genotype a name you can cite; commits
give a change a parent and an author; three-way merge gives you a defined answer when two
proposals touch the same gene; and a check-run gate gives you somewhere to attach "this passed".
Every one of those is a problem edit review already has.

**"Could the verifier just always agree with the other agents?"**
It could be written that way, and that would be a broken demo — SPEC §4.3 says so explicitly.
The verifier reads the measured simulation output rather than the upstream agents' prose, so it
can fail an edit that the structural or assay agent was optimistic about. If you want to see it,
ask for the case where the structural annotation is favourable and the measured metrics are not.

**"What stops me putting something dangerous in the box?"**
Category-level refusal plus a repository that has nothing actionable in it to leak. There are
no guide sequences, primers, vectors, delivery constructs, protocols or wet-lab parameters
anywhere in the codebase, and the policy module itself contains no pathogen or toxin target
list — it names the *kind* of thing being asked for, never a specific agent or organism.

**"Where does the data come from?"**
One locus, one short public reference region, three variants. Every fixture is labelled
`public-reference` or `synthetic-illustrative`. No patient data, no accession-backed
performance claims, no citations we cannot stand behind.

---

## If something breaks

**The 3D protein viewer can't reach the network.**
Skip it and say so plainly. It is on its own branch (`feat/protein-viewer`) and is **not part
of SPEC §9's definition of done** — every one of the six steps above runs with the network
unplugged. The gene track, the diff, the simulation and the pipeline are all local module
calls over `src/data/loci.json`. Move to step 2 and keep going.

**The pipeline errors mid-run.**
Do not retry blindly in front of the judge. Say which check it died on — that is itself the
interesting part of the architecture — and fall back to the audit trail: the delta DAG is
append-only, so the deltas from the agents that *did* run are still there and still
attributed. Expand them and walk the partial record.

**The cell canvas stalls or renders nothing.**
The simulation is headless and seeded; the canvas is only a renderer. Pull the metrics
(`occlusion`, `meanFlow`, `sickledFraction`) out of the agent CI panel's assay check instead
and make the same point from the numbers.

**The gate blocks something you meant as the happy path.**
Good — that is the honest failure mode, and the README already admits it. Say "that's the
over-blocking I mentioned", then run the in-scope case: a somatic repair at HBB with a stated
therapeutic rationale.

**You are running short on time.**
Steps **2, 4 and 5** are the demo. Diff, pipeline-with-the-gate-second, blocked request.
Steps 1, 3 and 6 are the ones to cut, in that order.

---

## Not in this checkout

Marked here so nobody promises them from the stage. See
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for what is verified in code today.

- `src/lib/agents/` and `src/lib/cellsim/` — specified in SPEC §4.3–§4.4, implemented on the
  `core/agents-cellsim` branch, not merged here.
- The three UI surfaces — `variant/ide-triptych`, `variant/lab-bench`, `variant/graph-first`.
- The 3D protein viewer — `feat/protein-viewer`.
