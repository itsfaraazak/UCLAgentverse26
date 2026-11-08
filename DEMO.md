# SigmaFold — demo script

**One line:** version control for genome edits. A proposed edit is a diff; a diff deserves CI.

**Surface:** `/bench` — the lab-bench variant. Built, routed, verified.
**Read first:** [`SPEC.md`](./SPEC.md) §4.5–§4.8 (ratified decisions and known gaps), §7 (safety boundary).
**Narrative:** [`docs/PITCH.md`](./docs/PITCH.md).

---

## Before you walk on

- [ ] `pnpm build && pnpm start`, or `pnpm dev` already warm. **Do not cold-start on stage.**
- [ ] Open **`/bench`** directly. The landing page at `/` lists three surfaces, but only `/bench` is routed on the integration branch — **the `/ide` and `/graph` cards 404. Don't click them.**
- [ ] Gene track zoom set to **Modelled region**. pO₂ at its default. Simulation **running**.
- [ ] Branch selector showing **`main`**.
- [ ] Know the locus numbers the page is actually rendering (see *Numbers* below) — they come from the fixture, and the fixture is changing under us.

---

## The 3-minute core run

Five steps. Each one sets up the next. Times are cumulative.

---

### 1 — The locus, and what we actually hold · 0:00–0:25

**Click:** nothing yet. Point at the **gene track**. Then toggle zoom **Whole locus → Modelled region → Codon level**.

**They see:** an SVG track for *HBB* on chromosome 11, exons laid out to their annotated extent, the region we hold sequence for drawn solid and everything past it **greyed**. At codon level, individual codons with a marker on the edited one.

**Say:** the reference is **NCBI RefSeq NM_000518.5**, human haemoglobin subunit beta mRNA, labelled `public-reference` in the fixture. Read the modelled-region figure off the page rather than quoting one from memory.

> **Non-trivial because:** codon 31 straddles the exon 1 / exon 2 boundary — exon 1 encodes codons 1–30 plus the first base of codon 31. The track has to render a region where codon numbering and exon numbering disagree, and label which one each number means. It greys what it does not hold instead of padding it.

---

### 2 — Branches, and the three-register diff · 0:25–1:00

**Click:** the **branch selector** in the title bar. Step `main` → `observed/hbs` → `therapy/hbb-repair`. Then click through the **filmstrip** below the track.

**They see:** three real branches. The filmstrip is the lineage: reference → observed genotype → proposed edit, each frame carrying its own **commit short-oid** and the branch it sits on. Under it, **one codon grid in three synchronised registers** — DNA bases, codons, amino acids.

Stop on `therapy/hbb-repair`. **Exactly one row is changed.** Codon **7**: `GTG` → `GAG`, **V → E**. Every other row reads `same`.

**Say:** CDS numbering — codon **7**. The fixture carries both names: `p.Glu7Val` for the substitution and the legacy `Glu6Val / E6V`, which counts from the mature protein after the initiator methionine is cleaved. Same substitution, two conventions. **Don't convert between them out loud.**

> **Non-trivial because:** the diff is a codon-level **global alignment** — a Needleman–Wunsch table scoring match `2`, mismatch `0`, gap `-1`, chosen so a mismatch beats a pair of gaps. Not a positional zip. A single-nucleotide change therefore reports as **one `changed` row**, and a real indel produces `added`/`removed` rows and keeps the following codons aligned instead of truncating the shorter sequence.
>
> And the honest limit: `DiffRow.codonIndex` is the **alignment row**, not a CDS coordinate. For a substitution they coincide. Past an indel they diverge, and one row cannot name a position in two coordinate systems at once — so it reports the row only (SPEC §4.5 #2).

---

### 3 — Drop the oxygen · 1:00–1:30

**Click:** the **pO₂ slider**. Drag from the default down past the onset threshold toward the floor. Hold each genotype for a beat: reference, then `HbS / HbS`, then post-repair.

**They see:** at high pO₂ the three look alike. Below the onset band the sickle genotype deforms, gains drag, jams in the constriction. **Occlusion** climbs, **flow** as a percentage of reference collapses, **sickled %** climbs. Reference and post-repair keep flowing.

**Say:** the only input that differs between genotypes is `polymerizationTendency` — **0.0** reference, **0.85** sickle, **0.05** post-repair. Read the live occlusion and flow figures off the readout strip. Point at the **"Illustrative model — not calibrated haemorheology"** badge *while* you say the numbers, not after.

**Say also:** `occlusion` measures *pathological* blockage by sickled cells in the neck, not geometric narrowing — which is why the reference genotype sits at ~0 **by construction**, not at some baseline the capillary's shape sets (SPEC §4.5 #11).

> **Non-trivial because:** the simulation is **seeded and headless** — Mulberry32, never `Math.random()`. Same seed and params replay identically. So the number on the canvas is the same number the assay agent reads in step 4. There is no second, prettier copy of the physics for the UI, and therefore no two sets of numbers to disagree about.

---

### 4 — Run the pipeline · 1:30–2:15

**Click:** **Run checks** in the check panel. Then expand two rows to show their deltas.

**They see:** seven checks resolving in fixed order —

1. `IntentAgent`
2. **`BiosafetyGateAgent`** ← the gate
3. `EditPlannerAgent`
4. `StructuralImpactAgent`
5. `FunctionalAssayAgent`
6. `OffTargetRiskAgent`
7. `VerifierAgent`

— and underneath, an **append-only audit trail**: one attributed delta per agent, each naming the deltas it was derived from.

**Say three things, fast:**

- The gate is at **position 2** — upstream of every structural and functional claim. A refused run **ends there**: agents 3–7 do not execute, so nothing downstream is computed. The panel says how many of the seven ran.
- Some verdicts **block outright**; some **hold the edit for a named human sign-off** and nothing in the pipeline can clear one. That is the whole of what I'll say about the policy's content — the interesting part is that it's *positional*, not what it filters.
- Every agent is **deterministic and LLM-free**. A judge can re-derive any verdict by hand.

**Then say:** the assay agent runs at the requested pO₂ — high enough that a naive read reports preserved flow even for the sickle allele. The **verifier does not read that prose**. It re-runs the simulation itself, at the **pO₂ floor**, against the reference genotype, and compares. Open the verifier's delta and show the three measured metric blocks: its own high-pO₂ run, its own low-pO₂ run, and the reference low-pO₂ run.

> **Non-trivial because:** `parents` is what makes the trail a **DAG, not a log**. When the verifier disagrees, it does not edit the earlier delta — there is no update and no delete. It appends a `verdict` delta whose `parents` include the claim it contradicts. The record **forks**, and both the optimistic claim and the refutation stay attributed and ordered. Mutation would destroy exactly the disagreement an audit trail exists to record.

---

### 5 — The merge the gate refuses · 2:15–2:50

**Click:** branch selector → **`observed/hbs`**. **Run checks**. Then **Merge into main**.

**They see:** **Merge stopped.** Not a warning badge beside a completed merge — no merge commit, no tree, no ref movement. The panel names the failing check and prints the verifier's reasons verbatim.

**Say:** this is the claim of the whole project in one screen. **The check is structural.** `evaluateMerge` resolves the merge base, walks **every commit the merge would introduce**, and demands a completed passing check on each one. A commit with no check run is `check-missing` — refused. A pending check is refused. **It fails closed in all three directions.** `Repo.merge` is never called until the gate has already said yes.

**Then click:** branch selector → **`therapy/hbb-repair`** → **Merge into main**.

**They see:** also refused — and the panel lists reasons from **two** commits, not one.

**Say:** merging the repair branch introduces two commits — the observed-genotype commit *and* the repair commit. The gate evaluates both. **You cannot launder a failing commit through a later good one.** That is the property the test suite pins.

> **Non-trivial because:** `mergeBase` is a genuine **best common ancestor** — it computes the common-ancestor set, discards any ancestor that is dominated by another, and picks deterministically (lowest oid) among what remains, so it is symmetric. A dominated base would make the three-way merge see a gene as changed on both sides when only one side touched it — a **spurious conflict** — and would inflate the commit set the gate has to walk.
>
> Criss-cross histories can have several equally good ancestors. Git resolves that with recursive merge; **this prototype does not.** Lowest-oid is deterministic, not correct in the full sense. We document it rather than claim it (SPEC §4.6 #17).

---

### Close · 2:50–3:00

**Say:** content-addressed objects, real three-way merge, a merge gate that fails closed, a deterministic simulation the verifier can re-run, and an append-only trail of who claimed what. **217 tests, 19 files.** The artifact a researcher currently cannot produce is the one thing this repository is.

---

## The 60-second cut-down

**Steps 2 → 4 → 5.** Diff, pipeline-with-the-gate-second, the merge that gets refused.

Drop in this order:

| Drop # | What goes | Why it's droppable |
|---|---|---|
| 1 | **Step 3** (pO₂ slider) | Prettiest, least load-bearing. Step 4's verifier delta carries the same metrics as text. |
| 2 | **Step 1** (gene track) | Say "one locus, HBB, NM_000518.5" over step 2's diff and move on. |
| 3 | The **second half of step 5** (repair branch, two commits) | Keep the first refusal. The multi-commit point survives as one spoken sentence. |
| 4 | The **delta expansion** in step 4 | Let the seven check rows carry it. Say "every one of those is an attributed record with its parents". |

**Never drop:** the gate's position at **2**, and the words *"the merge is refused in code, not warned about"*.

---

## Numbers

Every figure below traces to a file. **Nothing here is estimated.**

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
| Branches on `/bench` | `main`, `observed/hbs`, `therapy/hbb-repair` | `src/app/bench/bench-data.ts` |
| Test suite | **217 tests, 19 files** (`pnpm test`) | this checkout |

**The modelled-region figure is in flux — read it off the page.** The fixture in the integration build holds **31 codons / 93 nt**, translating to `MVHLTPEEKSAVTALWGKVNVDEVGGEALGR`, with exons annotated out to codon 147. The `feat/ai-harness` branch replaces that with the **full 444 nt CDS — 148 codons, 147 residues plus the terminator** — sliced at **offset 50** from a committed **628 nt** NM_000518.5 record with retrieval provenance. The first 93 nt are byte-identical either way, so **codon 7 and the whole worked example are unchanged**. Say whichever number the gene track is showing.

---

## If a judge asks

**"Is the simulation validated?"**
**No — and deliberately not.** It is an illustrative 2D particle model of flow through a constriction, with parameters chosen so the genotypes read differently on a projector. `loci.json` says so in its own `_note`; the panel says so on screen; `ASSAY_MODEL_LIMITATION` travels with every assay payload. It is not calibrated against experimental haemorheology and is **not predictive**. What *is* real: it is deterministic, seeded and headless, so the verifier can re-run it and get the same number twice. The honesty is the feature — an uncalibrated model that the pipeline treats as evidence is exactly the thing an audit trail should let you catch.

**"Could the verifier just always agree with the other agents?"**
**No.** It never reads the upstream agents' prose. It reads the **plan** and re-runs `cellsim` itself — at the pO₂ floor, against the reference genotype — and compares measured occlusion and sickled fraction against fixed margins. It can and does fail a change the structural and assay agents approved, and when it does, the verdict delta names the specific disagreement (`disagreedWithAssay`, `disagreedWithStructural`). SPEC §4.3 states it outright: *a demo where the verifier always agrees is a broken demo.* The test suite plants optimistic upstream deltas and asserts the verifier overrides them.

**"Where is AI used, and which parts are deterministic?"**
The pipeline is **deterministic and LLM-free, end to end.** Intent parsing is lexical. The planner resolves against a curated fixture and fabricates nothing. Structural claims are copied out of the fixture with their `confidence` and `limitation` fields attached. The assay is a seeded simulation. The verifier is arithmetic over simulation output. The policy gate is a frozen table. `Delta.id` is content-addressed and `createdAt` is a **logical counter, not wall-clock**, so a whole run is reproducible. The "agents" are a pipeline topology with attribution and a DAG — that is the part we claim. It buys auditability and costs capability: an intent the registry cannot resolve is out of scope, **not** reasoned about. Say that plainly; it's the more interesting answer.

**"Why Git? Isn't that just a metaphor?"**
It's load-bearing. The thing missing from edit review is not more analysis — it's an **identity for a proposal**. Content addressing gives a genotype a name you can cite, and two repositories that build the same genotype independently derive the *same* oid (the suite asserts this across two `Repo` instances with keys written in different orders). Commits give a change a parent and an author. Three-way merge gives a defined answer when two proposals touch the same gene — and a **conflict**, unresolved, when they touch it differently. A check-run gate gives you somewhere to attach *this passed*. Every one of those is a problem edit review already has and currently solves in slide decks.

**"What happens when two people edit the same gene differently?"**
It's a conflict and **it stays one.** `merge` returns `{ conflicts }` and writes nothing — no tree, no commit, no ref movement — handing you the gene plus all three object ids (base, ours, theirs) so a human can diff both sides and decide. Auto-resolving would be the tool inventing a scientific judgement, and would bury the fact that two people disagreed. *(Not in the current `/bench` frames — the three branches are a linear lineage. It's unit-tested, and `docs/ARCHITECTURE.md` §3 has the worked example.)*

**"Is the screening a real security control?"**
No, and we don't present it as one. It is deterministic and auditable by design — a reviewer can read the file and re-derive every verdict by hand — which also means it **over-blocks on innocent phrasing and can be evaded by paraphrase**. It belongs *in front of* a human biosafety officer, never in place of one. Its value in this architecture is positional: it runs before the analysis, and a refused run has no downstream output to disclaim.

**"Does a refused request get stored?"**
No. Policy reasons are static strings never templated with user input; a block-class verdict is marked `redacted`, gene symbols are dropped, and the only trace is a 16-character SHA-256 prefix. A test types a unique marker into a refused request and asserts it appears **nowhere** in the serialised result.

**"What's missing?"**
Said plainly, and all of it is in `SPEC.md` §4.8 and `docs/ARCHITECTURE.md` §7: one locus; no indel *fixture*, so the diff view has no real indel to render; `DiffRow` cannot carry CDS coordinates past an indel; `mergeBase` picks lowest-oid on a criss-cross rather than doing recursive merge; no structure prediction anywhere; no lab methods, reagents or protocols anywhere, **by policy**; and **no UI control that creates a branch** — the three branches are built by `repo.branch()` in `bench-data.ts` and the UI switches between them. It's a hackathon prototype. Not a clinical tool, not a biosafety control, not validated for any purpose.

---

## If something breaks

**Network drops.**
Keep going and say so. **Every step above is a local module call** over `src/data/loci.json` — the track, the diff, the simulation, the pipeline, the merge gate. There is no API, no model call, no fetch in the core run. The one thing that wants the network is the 3D protein viewer, which is on its own branch and **not in the core run**.

**A 3D view won't load.**
Skip it. Say it's a separate renderer on `feat/protein-viewer` / `feat/genome-3d-upload`, not part of the demo's spine, and move on. Do not debug a GPU on stage.

**The pipeline errors mid-run.**
**Do not retry blindly.** Say which agent it died on — that is itself the architecture, because the ordering is the claim. Then fall back to the trail: the DAG is **append-only**, so the deltas from the agents that *did* run are still there, still attributed, still carrying their parents. Expand them and walk the partial record. A pipeline that half-failed and left a readable record is a better story than one that silently succeeded.

**The canvas stalls or renders nothing.**
The simulation is headless; the canvas is only a renderer. Pull `occlusion`, `meanFlow` and `sickledFraction` out of the assay delta in the check panel and make step 3's point from the numbers. Nothing is lost but the animation.

**A merge you expected to pass gets refused.**
**Known, and it is not a staged failure.** At the pipeline's default assay window the verifier's independent low-pO₂ run puts the post-repair genotype's occlusion above its reference-plus-margin threshold, so the repair's own check **fails too**. The passing path is pinned in `src/lib/agents/pipeline.test.ts` at a shorter assay window; at the default it does not pass. Don't pretend otherwise mid-demo — say "the verifier is strict enough to fail our own happy path at this setting, and that's the margin being load-bearing rather than decorative", and keep the refusal as the beat. Fix the threshold before the next run, not on stage.

**You clicked `/ide` or `/graph` and got a 404.**
Those cards are on the landing page; the routes land with `variant/ide-triptych` and `variant/graph-first`. Go back to `/bench` and don't mention it.

**The branch selector won't switch.**
Use the **filmstrip** instead — selecting a frame selects its branch. Same state, two controls.

**You run short.**
Go to the 60-second cut above and take the drops in order. Do not speed up; drop steps.
