# SigmaFold — demo script

**One line:** *T3 Code, but the versioned artifact is a genome.* A proposed edit is a diff; a diff deserves CI.

**Surface for the core run:** **`/ide`** — the triptych. Branch rail │ gene track + diff │ agent CI.
It is the surface that *looks like* the claim, so it is the one to demo.

**Read first:** [`GOALS.md`](./GOALS.md) §2–§3 (the mapping, the definition of done) ·
[`CONVENTIONS.md`](./CONVENTIONS.md) §7 (honesty rules) · [`SPEC.md`](./SPEC.md) §4.5–§4.8 ·
[`docs/PITCH.md`](./docs/PITCH.md) for the spoken narrative.

---

## Before you walk on

- [ ] Run from **`sigmafold/paramveer`**. `main` has `lib/` but **no UI routes at all** — demoing from `main` gets you the landing page and nothing else.
- [ ] `pnpm build && pnpm start`. **Never `pnpm dev` in the foreground.** Background it, check it, kill it.
- [ ] Open **`/ide`** directly. It opens on branch **`edit/hbb-codon7-repair`**.
- [ ] **Verified routed:** `/ide`, `/bench`, `/`. **`/graph` is still merging — do not click it and do not promise it.**
- [ ] Bottom panel on the **Cell canvas** tab. Theme whichever reads better on the projector; both are deliberate.
- [ ] **Run the checks once in private first.** Session runs live in server memory and clear on restart, so a cold process has no run recorded — which is itself step 5's first beat, but only if you mean it.

**Keyboard, if you want to look fast:** `⌘K` palette · `⌘↵` run checks · `⌘G` jump to the edited codon · `⌘⇧M` attempt merge · `⌘J` toggle the bottom panel · `⌘⇧C` canvas · `⌘⇧R` red-team console.

---

## The 3-minute core run

Five steps. Times cumulative.

---

### 1 — The locus, and what we actually hold · 0:00–0:25

**Click:** the gene track. Cycle zoom **Locus → Exon → Codon** (or `⌘K` → "zoom").

**They see:** *HBB* on chromosome 11, exons to their annotated extent, the region we hold sequence for drawn solid and **everything past it greyed**. At codon level, individual codons with a marker on the edited one.

**Say:** the reference is **NCBI RefSeq NM_000518.5**, human haemoglobin subunit beta, labelled `public-reference`. The locus is annotated out to **codon 147**; the integration build currently holds sequence for the first **31 codons / 93 nt**, and the track greys the rest rather than padding it. Read the figure off the page — it changes when `feat/ai-harness` lands (see *Numbers*).

> **Non-trivial because:** the snapshot carries **three** codon counts — `modelledCodonCount` **derived from the bases**, `declaredCodonCount` as the fixture *claims*, and `totalCodonCount` from the exon annotation. It renders the derived one. A fixture that lies about its own length cannot quietly become a rendering surprise.
>
> And codon 31 **straddles the exon 1 / exon 2 boundary** — exon 1 encodes codons 1–30 plus the first base of codon 31. The track renders a region where codon numbering and exon numbering disagree and labels which is which.

---

### 2 — The branch rail, and the three-register diff · 0:25–1:05

**Click:** the **branch rail** on the left. Walk down it: `main` → `patient/hbss-baseline` → `edit/hbb-codon7-repair`, then across to `edit/hbb-silent-probe`.

**They see:** four real branches, indented by depth, each with its **head short-oid**, author and commit message. The reference, a patient baseline branched from it, and **two competing proposed edits branched from that baseline**. The diff and the gene-track marker change with every selection.

Stop on `edit/hbb-codon7-repair`. Each branch diffs against **its own base branch**, not against `main` — so this one reads **codon 7: `GTG` → `GAG`, V → E**, exactly one changed row. Press `⌘G` to jump to it.

**Say:** CDS numbering — codon **7**. The fixture carries both names: `p.Glu7Val` for the substitution and the legacy `Glu6Val / E6V`, which counts from the mature protein **after the initiator methionine is cleaved**. Same substitution, two conventions. **Do not convert between them out loud.**

**Then click:** `edit/hbb-silent-probe`. **Codon 5, `ACT` → `ACC`** — the DNA register changes, the **amino-acid register does not**, and the row is flagged `silent`. Labelled `synthetic-illustrative`, and it is in the fixture precisely to prove the three registers are not one register drawn three times.

**Say the honest limit:** there is **no branch-creation control in the UI**. The four branches are real and built through `lib/vcs` — `repo.branch()` then `repo.commit()` — and the rail switches between them. `GOALS.md` §3 asks for *create and switch*; **we have switch.** Say it and move on; nobody minds a stated gap.

> **Non-trivial because:** the diff is a codon-level **global alignment** — a Needleman–Wunsch table scoring match `2`, mismatch `0`, gap `-1`, chosen so a mismatch beats a pair of gaps. Not a positional zip. A single-nucleotide change reports as **one `changed` row**; a real indel produces `added`/`removed` rows and keeps the following codons aligned instead of truncating the shorter sequence.
>
> And the limit we do not paper over: `DiffRow.codonIndex` is the **alignment row**, not a CDS coordinate. For a substitution they coincide; past an indel they diverge, and one row cannot name a position in two coordinate systems at once (SPEC §4.5 #2).

---

### 3 — Drop the oxygen · 1:05–1:35

**Click:** bottom panel → **Cell canvas** (`⌘⇧C`). Drag the **pO₂ slider** from its default down past the onset band toward the floor. Do it on `patient/hbss-baseline`, then on `edit/hbb-codon7-repair`.

**They see:** above the onset threshold the two look alike. Below it the sickle baseline deforms, gains drag, jams in the constriction; **occlusion** climbs, **flow** collapses, **sickled fraction** climbs. The repair branch keeps flowing.

**Say:** the only input that differs is `polymerizationTendency` — **0.0** reference, **0.85** sickle, **0.05** post-repair, straight out of the fixture. Read the live figures off the readout. Point at the **illustrative-model** label *while* you say the numbers, not after.

**Say also:** `occlusion` measures *pathological* blockage by sickled cells in the neck, **not geometric narrowing** — which is why the reference sits at ~0 **by construction** rather than at some baseline the capillary's shape sets (SPEC §4.5 #11).

> **Non-trivial because:** the simulation is **seeded and headless** — Mulberry32, never `Math.random()`; same seed and params replay identically. Changing pO₂ does **not** re-seed the population; switching branches does, deliberately, because a fresh genotype deserves a fresh reproducible run. So the number on the canvas is the number the assay agent reads in step 4. There is no second, prettier copy of the physics for the UI — and therefore no two sets of numbers to disagree about.

---

### 4 — Run the pipeline · 1:35–2:15

**Click:** **Run checks** in the right-hand CI panel (`⌘↵`). Expand two rows. Then switch the bottom panel to **Delta trail** (`⌘J`).

**They see:** seven checks resolving in fixed order —

1. `IntentAgent`
2. **`BiosafetyGateAgent`** ← the gate
3. `EditPlannerAgent`
4. `StructuralImpactAgent`
5. `FunctionalAssayAgent`
6. `OffTargetRiskAgent`
7. `VerifierAgent`

— and in the trail, an **append-only DAG**: one attributed delta per agent, each naming the deltas it was derived from.

**Say three things, fast:**

- The gate is at **position 2** — upstream of every structural and functional claim. A refused run **ends there**: agents 3–7 do not execute, so nothing downstream is computed and there is no result to print a disclaimer beside. The panel reports how many of the seven ran.
- Some verdicts **block outright**; some **hold the edit for a named human sign-off**, and nothing in the pipeline can clear one. That is all I will say about the policy's content — the interesting part is that it is **positional**, not what it filters.
- **The gate and the verifier are deterministic. No model is in that path.** Where AI does sit, it is allowed to do exactly three things and the rule is one sentence: **AI may only narrow, never unlock.**

**Then say:** the assay agent runs at the requested pO₂, which is high enough that a naive read reports preserved flow even for the sickle allele. **The verifier does not read that prose.** It re-runs the simulation itself, at the **pO₂ floor**, against the reference genotype, and compares. Open the verifier's delta and show its three measured blocks — its own high-pO₂ run, its own low-pO₂ run, and the reference low-pO₂ run.

> **Non-trivial because:** `parents` is what makes the trail a **DAG, not a log**. There is no update and no delete. When the verifier disagrees it does not edit the earlier delta; it appends a `verdict` whose `parents` include the claim it contradicts. The record **forks**, and both the optimistic claim and its refutation stay attributed and ordered. Mutation would destroy exactly the disagreement an audit trail exists to record.

---

### 5 — The merge the gate refuses · 2:15–2:50

Three refusals, each a different door, ten seconds each.

**(a) Absence is not a pass.** On a branch you have **not** run checks for, hit **Attempt merge** (`⌘⇧M`).
**They see:** refused — `check-missing`, *"N incoming commit(s) have no completed check. Run the pipeline first."*
**Say:** **fail closed.** A missing check is not a pass. Neither is a pending one.

**(b) A failing check stops it.** Select **`patient/hbss-baseline`**, **Run checks**, then **Attempt merge** into `main`.
**They see:** **refused** — `check-failed`, with the verifier's reasons printed verbatim. **No merge commit. No merged tree. No ref movement.**
**Say:** this is the whole project in one screen. The sickle baseline cannot merge into the reference, and **the check is structural** — `evaluateMerge` resolves the merge base, walks **every commit the merge would introduce**, and demands a completed passing check on each. `Repo.merge` is **never called** until the gate has already said yes. There is no merged tree sitting behind a warning badge.

**(c) An escalation needs a human.** If you are running the escalation beat, submit your prepared request through the **red-team console** (`⌘⇧R`) on this branch and attempt the merge.
**They see:** **held** — `awaiting-signoff`, naming the role required. A sign-off field appears. Entering a name unlocks the merge; **the role is never typed by the client.**
**Say:** `signOffAction` takes a run id and an approver name and **no role parameter** — the role is derived server-side from the policy's own verdict. A review found exactly that bypass: a client-supplied `role` field let a crafted payload forge a sign-off. It is closed, and the closure is why the parameter is absent rather than validated.

> **Non-trivial because:** pipeline runs are held **server-side and addressed by id**, so the gate decides from the run the server computed — not from a run shape the client handed back. **The client cannot forge a passing run.**
>
> And `mergeBase` is a genuine **best common ancestor**: it builds the common-ancestor set, discards any candidate dominated by another, and picks deterministically among what remains, so it is symmetric. A dominated base would make the three-way see a gene as changed on both sides when only one side touched it — a **spurious conflict** — and would inflate the commit set the gate must walk.

---

### Close · 2:50–3:00

**Say:** content-addressed objects, real three-way merge, a gate that fails closed in three directions, a deterministic simulation the verifier re-runs itself, an append-only trail of who claimed what, and **265 tests across 22 files** on the integration branch. The artifact a researcher currently cannot produce is the one thing this repository is.

---

## The 60-second cut-down

**Steps 2 → 4 → 5(b).** Diff, pipeline-with-the-gate-second, the merge that gets refused.

Drop in this order:

| Drop # | What goes | Why it's droppable |
|---|---|---|
| 1 | **Step 3** (pO₂ canvas) | Prettiest, least load-bearing. Step 4's verifier delta carries the same metrics as text. |
| 2 | **Step 1** (gene track) | Say "one locus, HBB, NM_000518.5" over step 2's diff and move on. |
| 3 | **5(a)** and **5(c)** | Keep 5(b). The fail-closed and sign-off doors survive as one spoken clause each. |
| 4 | The **silent probe** in step 2 | Keep the repair diff. Say "and a synonymous change moves the DNA register and not the amino-acid one". |
| 5 | The **delta-trail tab** in step 4 | Let the seven check rows carry it. Say "each one is an attributed record naming its parents". |

**Never drop:** the gate's position at **2**, and the words *"the merge is refused in code, not warned about"*.

---

## Numbers

Every figure traces to a file. **Nothing here is estimated.**

| Thing | Value | Where |
|---|---|---|
| Locus | `HBB`, chromosome 11, `public-reference` | `src/data/loci.json` |
| Reference record | NCBI RefSeq **NM_000518.5** | `loci.json` HGVS strings |
| Sickle substitution | CDS codon **7**, `GAG` → `GTG`, **E → V** | `loci.json` → `HBB_HbS` |
| | `NM_000518.5(HBB):c.20A>T` · `p.Glu7Val` · legacy `Glu6Val / E6V` | same |
| Restored reference | codon **7**, `GTG` → `GAG`, **V → E** · `c.20T>A` · `p.Val7Glu` | `loci.json` → `HBB_repair` |
| Silent case | codon **5**, `ACT` → `ACC`, T → T, `synthetic-illustrative` | `loci.json` → `HBB_silent_demo` |
| `polymerizationTendency` | 0.0 reference · 0.85 sickle · 0.05 post-repair | `loci.json` genotypes |
| Simulation defaults | seed `20260308`, 140 cells, constriction 0.42 | `loci.json` → `simulation.defaults` |
| pO₂ range | 10–100 mmHg, sickling onset below 60 | `loci.json` → `simulation.pO2` |
| Diff alignment scoring | match `2`, mismatch `0`, gap `-1` | `src/lib/genome/diff.ts` |
| Oid | `sha256(canonicalJson(object))`, 64 hex, **first 12 shown** | `src/lib/vcs/canonical.ts` |
| Verifier margins | occlusion `+0.12`, sickled fraction `+0.20`, poly `≥ 0.3` fails | `src/lib/agents/pipeline.ts` |
| Branches on `/ide` | `main` · `patient/hbss-baseline` · `edit/hbb-codon7-repair` · `edit/hbb-silent-probe` | `src/lib/workspace.ts` |
| Commit author | `r.okonjo@sigmafold.dev`, fixed epoch so oids are stable | `src/lib/workspace.ts` |
| Model id, where AI is used | **`gemini-4-argon`** — never a `*-flash` variant, not even as a fallback | `src/lib/ai/models.ts` *(pending)* |
| Test suite | **265 tests, 22 files** on `sigmafold/paramveer` · 217 / 19 on `main` | `pnpm test` |

**The reference length is mid-landing — read it off the page.** `main` and the integration build hold **31 codons / 93 nt**, translating to `MVHLTPEEKSAVTALWGKVNVDEVGGEALGR`, with exons annotated to codon 147. **`feat/ai-harness` is pending** and replaces that with the **full 444 nt CDS — 148 codons, 147 residues plus the terminator** — sliced at **offset 50** from a committed **628 nt** NM_000518.5 record carrying its retrieval provenance. The first 93 nt are **byte-identical either way**, so codon 7 and the entire worked example are unchanged. `GOALS.md` §6 lists that genome as already on `main`; **it is not — it is on the pending branch.** Say whichever number the gene track is showing.

---

## Planned — do not promise these

| Thing | State |
|---|---|
| **`/graph`** (graph-first) | Still merging. Not routed on the integration branch. |
| **Three-pane app shell** as the primary frame | In progress. The variants are currently top-level routes, not mounted inside a shell. |
| **AI layer** (`lib/ai`) — intent parse, narration, second opinion | On `feat/ai-harness`, pending. Not wired into the running build. |
| **Full NM_000518.5 reference + FASTA upload** | Same branch, same status. |
| **3D genome view** | On `feat/genome-3d-upload`, pending. |
| **3D protein view** | Renderer is on `main`; it is not part of the core run. |
| **Branch creation from the UI** | Not built anywhere. Branches are real; only switching is exposed. |

---

## If a judge asks

**"Is the simulation validated?"**
**No — and deliberately not.** It is an illustrative 2D particle model of flow through a constriction, with parameters chosen so the genotypes read differently on a projector. The fixture says so in its own note, the limitation string travels with every assay payload, and the UI says it where the numbers appear. Not calibrated against experimental haemorheology, **not predictive**. What *is* real: it is deterministic, seeded and headless, so the verifier can re-run it and get the same number twice. The honesty is the feature — an uncalibrated model that a pipeline treats as evidence is exactly what an audit trail should let you catch.

**"Are the structural claims model output?"**
No. **Curated textbook summaries** carried in the fixture, each with its own `confidence` and `limitation` field, and the UI surfaces that limitation text rather than hiding it. **No structure prediction runs anywhere in this repository.**

**"Could the verifier just always agree with the other agents?"**
**No.** It never reads the upstream agents' prose. It reads the **plan** and re-runs `cellsim` itself — at the pO₂ floor, against the reference genotype — comparing measured occlusion and sickled fraction against fixed margins. It can and does fail a change the structural and assay agents approved, and the verdict names which it disagreed with (`disagreedWithAssay`, `disagreedWithStructural`). SPEC §4.3 says it outright: *a demo where the verifier always agrees is a broken demo.* The suite plants optimistic upstream deltas and asserts the verifier overrides them.

**"Where is AI used, and which parts are deterministic?"**
Be precise here, because the honest answer is the stronger one.

**Deterministic, LLM-free, today:** intent parsing (lexical), the planner (resolves against the curated fixture and fabricates nothing), structural claims (copied from the fixture with their limitation attached), the assay (a seeded simulation), the verifier (arithmetic over simulation output), the screening gate (a frozen table), and the merge gate. `Delta.id` is content-addressed and `createdAt` is a **logical counter, not wall-clock**, so a whole run replays.

**Where a model is allowed, on the pending AI branch:** exactly three places — **intent parsing**, **narration**, and a **second opinion** on screening. And one rule governs all three: **AI may only narrow, never unlock.**

- The deterministic `screen()` is authoritative, and it runs on the **raw user text**, independently of anything a model said about it — so a prompt injection that fools a parser cannot route around the lexical screen.
- Verdicts combine by **maximum restriction**. A model saying *allow* against a lexical *block* yields **block**.
- **A model never mints a verdict.** It selects a label from a **closed set** and the verdict is read out of the frozen policy table. An unrecognised label resolves to the restrictive default, not to *allow*.
- **The gate and the verifier stay deterministic — no model in that path.**
- Model output is untrusted data: parsed strictly against a schema, never evaluated, never allowed to select a code path by name. Nothing refused is ever transmitted.
- The model is **`gemini-4-argon`**. Never a `*-flash` variant, not even as a cheap fallback — if it errors, the error surfaces and the build degrades to the clearly-labelled non-AI path, because a reviewer must be able to tell which model produced which text, or whether any model did at all.

That buys auditability and costs capability: an intent the registry cannot resolve is **out of scope, not reasoned about**. Say that plainly; it's the more interesting answer.

**"Why Git? Isn't that just a metaphor?"**
It's load-bearing, and the mapping is one-to-one: repository → the locus; branch → a proposed genotype line; commit → one edit with its check run; diff → the three registers; CI run → the pipeline; required status check → the gate plus the verifier; pull request → a merge the gate can refuse. The thing missing from edit review is not more analysis — it's an **identity for a proposal**. Content addressing gives a genotype a name you can cite, and two repositories that build the same genotype independently derive the **same oid** (asserted across two `Repo` instances with keys written in different orders). Commits give a change a parent and an author. Three-way merge gives a defined answer when two proposals touch the same gene. A check run gives you somewhere to attach *this passed*. Every one of those is a problem edit review already has and currently solves in slide decks.

**"What happens when two people edit the same gene differently?"**
It's a conflict and **it stays one.** `merge` returns `{ conflicts }` and writes nothing — no tree, no commit, no ref movement — handing back the gene and all three object ids (base, ours, theirs) so a human can diff both sides and decide. Auto-resolving would be the tool inventing a scientific judgement and burying the fact that two people disagreed. *(The rail does show two competing edits off one baseline; each merges into that baseline, so the conflict path is unit-tested rather than on screen. `docs/ARCHITECTURE.md` §3 has the worked example.)*

**"Is `mergeBase` correct?"**
It is a **best** common ancestor and it is **symmetric** — and on a criss-cross history with several equally good ancestors it picks the **lowest oid**. That is deterministic and reproducible, **not correct in the full sense**. Git resolves that case with recursive merge; this prototype does not. **Documented, not hidden** (SPEC §4.6 #17).

**"Is the screening a real security control?"**
No, and we don't present it as one. It is a **deterministic lexical gate**, chosen so a reviewer can read the file and re-derive every verdict by hand — which also means it **over-blocks on innocent phrasing and can be evaded by paraphrase.** It belongs *in front of* a human reviewer, **never in place of one.** Its value in this architecture is positional: it runs before the analysis, so a refused run has no downstream output to disclaim. `src/lib/safety/policy.ts` is never modified by any thread — CI fails any PR that touches it.

**"Does a refused request get stored?"**
No. Policy reasons are static strings never templated with user input; a block-class verdict is marked `redacted`, resolved gene symbols are dropped, and the only trace is a **16-character SHA-256 prefix**. A test types a unique marker into a refused request and asserts it appears **nowhere** in the serialised result. The one free-text field that *is* persisted — an approver's name — is constrained to a name shape at the boundary, specifically so refused text cannot be pasted into the audit trail.

**"What's missing?"**
All of it is written down, in `GOALS.md` §6 and `SPEC.md` §4.8: `/graph` still merging; the app shell in progress; the AI layer and the full reference genome on a pending branch; no branch-creation control; no indel **fixture**, so the diff view has no real indel to render; `DiffRow` cannot carry CDS coordinates past an indel at all; `mergeBase` picks lowest-oid on a criss-cross; no structure prediction; and **no laboratory methods, reagents or protocols anywhere, by policy.** It's a hackathon prototype. Not a clinical tool, not a biosafety control, not validated for any purpose.

---

## If something breaks

**Network drops.**
Keep going and say so. **Every step above is a local module call** over `src/data/loci.json` — track, diff, simulation, pipeline, merge gate. No API, no model call, no fetch in the core run. The things that want the network — the 3D protein viewer and the pending AI layer — are **not in the core run**.

**A 3D view won't load.**
Skip it. It is a separate renderer and not part of the demo's spine. Each 3D component is required to degrade to an informative text fallback with a working retry — if you get a blank box instead, that is the bug, don't narrate it. **Do not debug a GPU on stage.**

**The pipeline errors mid-run.**
**Do not retry blindly.** Say which agent it died on — the ordering *is* the architecture, so that is content, not an excuse. Then fall back to the trail: the DAG is **append-only**, so the deltas from the agents that did run are still there, still attributed, still carrying their parents. Expand them and walk the partial record. A run that half-failed and left a readable record is a better story than one that silently succeeded.

**The canvas stalls or renders nothing.**
The simulation is headless; the canvas is only a renderer. Pull `occlusion`, `meanFlow` and `sickledFraction` out of the assay delta in the CI panel and make step 3's point from the numbers. Nothing is lost but the animation.

**"That run is no longer in this session."**
Runs live in **server-process memory** and clear when the process restarts. Hit **Run checks** again. Do not describe it as state loss — describe it as a prototype's session store, which is what it is.

**A merge you expected to pass gets refused — including the repair.**
**Known, and not a staged failure.** At the pipeline's default assay window the verifier's independent low-pO₂ run puts the post-repair genotype's occlusion above its reference-plus-margin threshold, so **`edit/hbb-codon7-repair`'s own check fails too.** The passing path is pinned in `pipeline.test.ts` at a shorter assay window; at the default it does not pass. Don't pretend otherwise mid-demo — say *"the verifier is strict enough to fail our own preferred outcome at this setting, which is the margin being load-bearing rather than decorative"*, and keep the refusal as the beat. **Fix the threshold before the next run, not on stage.**

**Do not demo `edit/hbb-silent-probe` as a passing merge.**
It is currently the **only** merge the gate allows, and it allows it for the wrong reason: the planner resolves the *variant in isolation* (`polymerizationTendency` 0.0) rather than the branch's **composite genotype** (0.85, which is what the canvas renders). So the gate passes a change that repairs nothing while the canvas on that same branch still sickles. **That is a real bug, written up for the PR.** Show the branch for its `silent` diff row in step 2 and stop there.

**You clicked `/graph` and got a 404.**
Expected — it is still merging. Go back to `/ide`, and if you want the simulation as the hero instead, `/bench` is routed and verified.

**You run short.**
Go to the 60-second cut and take the drops in order. **Do not speed up; drop steps.**
