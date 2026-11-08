# SigmaFold — Version Control for Genetic Engineering

**Status:** prototype spec, UCL AgentVerse 2026 (Biotech track).
**This file is the contract.** Every agent working on this repo reads it first and does not
contradict it. If something here is wrong or impossible, say so in your final report rather
than silently diverging.

---

## 1. The one-sentence pitch

SigmaFold treats a cell's genotype like a software repository: you open a **branch**, apply an
**edit** (a diff against a reference allele), and a **multi-agent CI pipeline** decides whether
that edit passes — structurally, functionally, and on biosafety grounds — before it can be
merged.

Git is the correct metaphor and we lean on it hard: content-addressed objects, commits with
parents, branches, three-way merge, merge conflicts, blame, and a check-run gate on the merge.

## 2. The user and the problem

A pre-clinical researcher proposing a therapeutic gene edit has no equivalent of CI. Edits are
reasoned about in slide decks and lab notebooks; there is no artifact that says *"this exact
change, against this exact reference, passed these exact checks, and here is the audit trail."*
SigmaFold is that artifact.

The headline worked example is the textbook sickle-cell case:

- `HBB` reference allele (HbA), codon 7 `GAG` → Glu
- the sickle allele (HbS), codon 7 `GTG` → Val — a single-nucleotide substitution
- a proposed repair edit that restores the reference codon

**A note on the numbering, because it trips people up.** This is codon **7** in CDS
numbering (`NM_000518.5(HBB):c.20A>T`, `p.Glu7Val`). The familiar legacy name is
"Glu6Val" / "E6V", which counts from the *mature* protein after the initiator methionine
is cleaved. Same substitution, two conventions. This spec and the code use CDS numbering
throughout; `loci.json` records both and carries a `numberingNote`. Do not silently
convert between them.

This example is used **descriptively and pedagogically only**. See §7.

## 3. Repository layout

```
src/
  app/                     Next.js App Router pages
  components/
    ui/                    shadcn/ui primitives (generated, do not hand-edit)
    genome-map/            SVG gene-track diagram  ← explicitly requested feature
    diff/                  DNA / codon / amino-acid diff views
    cell/                  live cell canvas renderer
    agents/                CI panel, check rows, delta audit trail
    redteam/               adversarial console
    shell/                 macOS-feel app chrome (titlebar, sidebar, command palette)
  lib/
    genome/                sequence model, genetic code, variants, diff engine
    vcs/                   content-addressed object store, branches, merge
    agents/                delta DAG + the agent pipeline
    safety/                screening policy  ← AUTHORED BY THE ORCHESTRATOR, see §7
    cellsim/               deterministic particle simulation
  data/
    loci.json              curated reference + annotation fixtures
```

## 4. Core modules — the contracts

### 4.1 `lib/genome`

```ts
type Base = 'A' | 'C' | 'G' | 'T';

/** A coding sequence with provenance. Always uppercase, always 5'→3'. */
interface Sequence { readonly bases: string; readonly label: string }

/** Standard genetic code. 64 codons → one-letter AA, '*' for stop. */
const CODON_TABLE: Readonly<Record<string, string>>;

function translate(bases: string): string;          // frame 0, stops at '*'
function codons(bases: string): string[];

/** A single edit against a reference, in 1-based codon coordinates. */
interface Variant {
  gene: string;
  codonIndex: number;        // 1-based
  refCodon: string;
  altCodon: string;
  kind: 'substitution' | 'deletion' | 'insertion';
  label: string;             // human-readable, e.g. "HbS (sickle allele)"
}

function applyVariant(seq: Sequence, v: Variant): Sequence;

/** Aligned, row-per-codon diff — the data behind the side-by-side view. */
interface DiffRow {
  codonIndex: number;
  refCodon: string | null;
  altCodon: string | null;
  refAa: string | null;
  altAa: string | null;
  status: 'same' | 'changed' | 'added' | 'removed';
  /** true when the codon changed but the amino acid did not */
  silent: boolean;
}
function diffSequences(ref: Sequence, alt: Sequence): DiffRow[];
```

`diffSequences` must handle unequal lengths (indels) without throwing, and must be pure.

### 4.2 `lib/vcs` — git for genomes

Content-addressed. `oid = sha256(canonicalJson(object))`, hex, first 12 chars shown in UI.

```ts
type Oid = string;

interface Blob   { kind: 'blob';   sequence: Sequence }
/** A genotype: gene symbol → blob oid. */
interface Tree   { kind: 'tree';   entries: Record<string, Oid> }
interface Commit {
  kind: 'commit';
  tree: Oid;
  parents: Oid[];          // 0 = root, 1 = normal, 2 = merge
  author: string;
  message: string;
  timestamp: number;
  edit?: Variant;          // the edit this commit introduces, if any
  checkRunId?: string;     // link to the CI result
}

class Repo {
  write(obj): Oid;  read(oid): Blob|Tree|Commit;
  commit(opts): Oid;
  branch(name, at?): void;  checkout(name): void;  branches(): string[];
  head(): Oid;  log(ref?): Commit[];
  mergeBase(a: Oid, b: Oid): Oid | null;
  /** Three-way merge of genotype trees. Per gene:
   *  - changed on one side only        → take that side
   *  - changed identically on both     → take it
   *  - changed differently on both     → CONFLICT, do not auto-resolve
   */
  merge(ours: Oid, theirs: Oid): { oid: Oid } | { conflicts: MergeConflict[] };
}
```

Determinism matters: the same inputs must produce the same oids across runs. Sort object keys
before hashing. No timestamps inside hashed content except the explicit `timestamp` field.

### 4.3 `lib/agents` — the harness

Vocabulary is inherited deliberately from this project's earlier Python pipeline
(`feature/deltagene-prototype` branch): an append-only DAG of attributed **deltas**, so
disagreement *forks* the record instead of overwriting it.

```ts
type DeltaKind =
  | 'intent' | 'screen' | 'edit_plan' | 'structural'
  | 'assay' | 'offtarget' | 'verdict' | 'signoff';

interface Delta {
  id: string; kind: DeltaKind; author: string; subject: string;
  payload: unknown; parents: string[]; createdAt: number;
}
class DeltaDAG { add(d): Delta; get(id): Delta; all(): Delta[]; history(id): Delta[] }
```

**Pipeline order is fixed and the gate comes first:**

| # | Agent | Role |
|---|---|---|
| 1 | `IntentAgent` | normalise free-text request into a structured intent |
| 2 | **`BiosafetyGateAgent`** | **screens the intent before any downstream work. `block` ends the run.** |
| 3 | `EditPlannerAgent` | resolve target locus + edit against `data/loci.json` |
| 4 | `StructuralImpactAgent` | amino-acid change → annotated structural consequence |
| 5 | `FunctionalAssayAgent` | run `cellsim` headless, return metrics |
| 6 | `OffTargetRiskAgent` | flag target against the curated sensitive-locus registry |
| 7 | `VerifierAgent` | cross-check claims against measured sim output; final pass/fail |

Agent 7 must be capable of **failing an edit that agent 4 or 5 was optimistic about** — the
verifier reads the actual sim numbers, not the other agents' prose. A demo where the verifier
always agrees is a broken demo.

Every agent is deterministic and LLM-free. This is the layer a judge can re-derive by hand.

### 4.4 `lib/cellsim`

Deterministic, seeded. 2D particle flow through a capillary with a constriction.

- Genotype → `polymerizationTendency ∈ [0,1]` (reference ≈ 0, sickle allele high, repaired low)
- UI control → `pO2` (oxygen tension)
- Per-cell state: `discoid | sickled`; transition probability rises as `pO2` falls and as
  `polymerizationTendency` rises
- Sickled cells gain drag and can jam at the constriction
- Exposed metrics: `occlusion` (0–1), `meanFlow`, `sickledFraction`

Must run headless via `step()` with no canvas/DOM, so `FunctionalAssayAgent` can call it.
Same seed + same params ⇒ identical metrics.

**This is an illustrative model, not validated hemorheology. The UI must say so on the panel.**

### 4.5 Ratified decisions

§4.1–§4.4 left some details unspecified. The implementation surfaced them; these are now the
contract. Reviewers should check against this list rather than filing them as findings.

| # | Question | Decision |
|---|---|---|
| 1 | Does `translate` emit the stop codon? | **Yes** — `*` is included in the output, then translation halts. |
| 2 | What is `DiffRow.codonIndex` after an indel? | The **1-based alignment row**, not a biological CDS index. For substitutions the two coincide; after an indel the two sequences' biological numbering diverges and `DiffRow` carries only the row. A UI showing CDS coordinates past an indel must derive them itself. |
| 3 | `MergeConflict` shape | `{ gene: string; base: Oid \| null; ours: Oid \| null; theirs: Oid \| null }`. |
| 4 | Merge commit metadata | `parents: [ours, theirs]`, author `sigmafold-merge`, `timestamp = max(ours, theirs) + 1` so oids stay deterministic. HEAD moves only if it currently points at `ours`. |
| 5 | `commit(opts)` fields | Required `tree`, `author`, `message`. Optional `timestamp`, `parents` (defaults to `[HEAD]`, or `[]` at root), `edit`, `checkRunId`. |
| 6 | Insertion coordinates in `applyVariant` | `altCodon` is inserted **at** `codonIndex`; the codon already there shifts right. Appending is `codonIndex === length + 1`. |
| 7 | HBB modelled region length | **31 codons / 93 nt**, translating to `MVHLTPEEKSAVTALWGKVNVDEVGGEALGR`. An earlier `codonCount: 30` in `loci.json` was wrong and is fixed. Codon 31 straddles the exon 1 / exon 2 boundary, so the modelled region extends one codon past exon 1. |
| 8 | Which gene symbols may `IntentAgent` resolve? | `loci.json` **∪ `FLAGGED_LOCI`**, plus fixture aliases (`HbS`, `sickle`) that map back to a listed gene. Nothing outside those lists is ever emitted. Resolving against `loci.json` alone would route `knock out TP53` to `OUT_OF_SCOPE` instead of `TUMOUR_SUPPRESSOR_DISRUPTION`, which would defeat the red-team demo. |
| 9 | Does `escalate` stop the pipeline? | **No — only `block` terminates.** `escalate` still runs agents 3–7, but sets `mergeAllowed: false` and `requiresSignoff: true`. The `signoff` delta kind exists for the UI to write; no agent emits one. |
| 10 | What pO2 does the assay use? | The requested or default pO2 (95). That is high enough that a naive assay reports `flow_preserved` even for the sickle allele. `VerifierAgent` **independently re-runs the simulation at `pO2.min` against wildtype** and can therefore disagree. This is the structural reason a verifier-always-agrees demo cannot happen. |
| 11 | What does `occlusion` measure? | *Pathological* blockage caused by sickled cells in the constriction — **not** geometric narrowing. So the reference genotype sits at ~0 by construction, not at some baseline set by the capillary's shape. |
| 12 | `Delta.id` and `createdAt` | `id` is a content-addressed sha256 prefix with parents validated on insert. `createdAt` is a **logical counter**, not wall-clock time, so a pipeline run is reproducible. |

Note on #2: this is a real limitation, not a shortcut. Reporting a single index keeps `DiffRow`
honest about the fact that one row cannot name a position in two diverged coordinate systems at
once. Do not "fix" it by silently reusing the row number as a CDS coordinate.

### 4.6 Ratified decisions — round two

Seeded property testing escalated five genuine ambiguities rather than resolving them by
invention. These are the decisions. All five require an implementation change.

| # | Question | Decision |
|---|---|---|
| 13 | Sequences containing non-ACGT characters (`N`, RNA `U`, junk) | **Reject with a clear error.** Current behaviour uppercases and then silently *halts* translation at the first unknown codon, so `ATGNNNCCC` yields `"M"` and drops the rest. Silent truncation is the worst option for a tool whose pitch is auditability. Validate at the boundary and throw naming the offending character and offset. Lowercase input stays accepted and normalised — that is meaning-preserving. |
| 14 | A trailing 1–2 nt partial codon in `diffSequences` | **Reject with a clear error.** This model diffs whole codons, and an indel in it is a whole number of codons. A non-multiple-of-3 input is malformed, not an edge case to paper over. Unequal *codon counts* remain fully supported (that is §4.1's indel requirement) — it is unequal *remainders* that are refused. |
| 15 | Is `refCodon` validated for an insertion? | **It is ignored, and that must be explicit.** Substitutions and deletions verify `refCodon` against the sequence; an insertion has nothing to verify. Throw if a caller passes a non-empty `refCodon` with `kind: 'insertion'`, so nobody believes a check happened that did not. |
| 16 | `merge(a, a)` | **No-op.** Return the existing oid; do not write a merge commit with `parents: [a, a]`. This matches Git and keeps history honest. §4.5 #4's metadata rules apply only to merges that actually combine two distinct commits. |
| 17 | Is `mergeBase` a *best* common ancestor, and is it symmetric? | **It must be both.** The current BFS-from-`b`-return-first-hit returns the common ancestor nearest `b`, which is not necessarily non-dominated, and gives `mergeBase(a,b) ≠ mergeBase(b,a)`. Compute the common-ancestor set, discard any that is an ancestor of another common ancestor, and pick deterministically (lowest oid) among what remains. |

**Why #17 is not cosmetic.** A dominated — too old — base makes the three-way merge see a gene
as changed on *both* sides when only one side touched it, producing a **spurious conflict**. It
also inflates the commit set `lib/merge-gate` walks when deciding which checks must be green.
Both failures lean safe rather than permissive, which is why nothing broke in testing, but both
are wrong.

**Known limitation to keep, and to state in the UI rather than hide.** Criss-cross histories can
have several equally-good common ancestors. Git resolves that with recursive merge; this
prototype does not. Picking the lowest oid makes the choice deterministic and symmetric, not
correct in the full sense. Document it; do not pretend it is resolved.

## 5. UI requirements (all three variants)

- **macOS app feel in the browser.** No Electron. Traffic-light chrome, translucent sidebar,
  system font stack, generous spacing, light **and** dark.
- **shadcn/ui** for every primitive. **lucide-react** for every icon — use it heavily and
  consistently; no emoji as UI icons, no mixed icon sets.
- **Genome map diagram** is mandatory and prominent: an SVG gene track showing the locus, its
  exons, and a marker at the edited codon, zoomable down to codon level.
- **Side-by-side diff** across three synchronised registers: DNA, codon, amino acid.
- **Live cell canvas** driven by the real `cellsim`, with a `pO2` slider.
- **Agent CI panel**: the seven checks as a run list with status, timing, and expandable
  per-agent delta detail.
- **Red-team console**: a free-text box. Anything typed goes through `lib/safety`. Blocked and
  escalated requests must render visibly as blocked/escalated with the policy reason.
- **Branch switcher** showing real branches from `lib/vcs`, with the merge gate.
- No placeholder/lorem content. Every number on screen comes from a real module call.
- Accessible: keyboard reachable, visible focus, labelled controls, AA contrast.

## 6. The three variants

Same core, three genuinely different takes on the surface. Do not converge.

| Branch | Concept |
|---|---|
| `variant/ide-triptych` | A code editor. Three panes: branch tree ∥ diff ∥ CI panel. Keyboard-first, ⌘K palette, monospace, dense. Feels like reviewing a pull request. |
| `variant/lab-bench` | A lab instrument. The cell canvas is the hero, full-bleed. Diff becomes a filmstrip timeline; agent checks are gauges and readouts. Feels like standing at a bench. |
| `variant/graph-first` | The commit DAG is the primary canvas — pan/zoom the history graph, click a node to open an inspector drawer with diff + verdicts. Feels like a git client. |

## 7. Safety boundary — NON-NEGOTIABLE

This is a demo about *engineering discipline*, not about how to make a change to an organism.
The following are hard constraints on the code, not stylistic preferences.

1. **No actionable construct design, ever.** The repository must contain no guide-RNA
   sequences, no primer sequences, no vector/delivery construct designs, no protocols, and no
   wet-lab parameters. `lib/genome` operates on a short curated reference region from
   `data/loci.json` for diffing and translation only.
2. **No pathogen or toxin content.** No sequences, names-as-targets, or functional detail for
   pathogens or toxins. A request in that category is refused by category label alone.
3. **`lib/safety` must not echo refused input.** For any `block`-class verdict, store and
   render only the policy category and a generic reason. Do not persist, log, or display the
   user's verbatim text, and do not restate what they asked for. Hash or discard it.
4. **The gate is structural.** `BiosafetyGateAgent` runs at position 2 and a `block` verdict
   terminates the pipeline. It is not a disclaimer rendered next to results that were computed
   anyway.
5. **Escalation requires a human.** `escalate` verdicts block the merge and require an explicit
   sign-off action in the UI. Nothing auto-approves an escalation.
6. **Label every fixture.** Entries in `data/loci.json` carry `"provenance":
   "public-reference"` or `"synthetic-illustrative"`. No real patient data, ever. No invented
   clinical performance claims, accession numbers, or citations.
7. **State the model's limits in the UI.** The simulation and the structural annotations are
   illustrative. The app must say that where the numbers appear.

`src/lib/safety/policy.ts` is authored by the orchestrator. **Agents must not add new policy
categories, loosen a verdict, remove a flagged locus, or route around the gate.** If you think
the policy is wrong, report it; do not edit it.

## 8. Engineering standards

- TypeScript strict. No `any` in `lib/`. No non-null `!` to silence the compiler.
- `lib/` is pure and framework-free — no React imports, no DOM access. It must be unit-testable
  in isolation, and the simulation must run headless.
- Vitest unit tests for `lib/genome`, `lib/vcs`, `lib/agents`, `lib/safety`, `lib/cellsim`.
  Cover: translation correctness, indel diffs, oid determinism, three-way merge including the
  conflict case, gate ordering, each policy category, and sim determinism.
- `pnpm build`, `pnpm lint`, and `pnpm test` must all pass before you report done. Run them.
  Do not report success on work you have not built.
- Conventional commits. Small, reviewable commits.

## 9. Definition of done for a UI branch

`pnpm dev` serves a page where a reviewer can, without touching the code:

1. see the gene-track diagram of the locus under edit,
2. switch between branches and read the real diff in all three registers,
3. drop pO2 and watch the cell canvas behaviour differ between genotypes,
4. run the agent pipeline and see seven checks resolve, with the audit trail,
5. type a request into the red-team console and watch the gate block or escalate it,
6. attempt a merge and be stopped by a failing or escalated check.
