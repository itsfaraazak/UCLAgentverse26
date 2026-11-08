# SigmaFold — goal and status

**One line:** Git for genetic engineering. The framing is *"T3 Code, but the versioned
artifact is a genome instead of source code."*

Branch a genotype, apply an edit as a diff, and a multi-agent CI pipeline decides whether it
passes — structurally, functionally, and on policy grounds — before it can merge.

Read [`SPEC.md`](./SPEC.md) for the contract and [`CONVENTIONS.md`](./CONVENTIONS.md) for how
to write code here. This file is the goal and the live status.

---

## 1. The user and the problem

A pre-clinical researcher proposing a therapeutic edit has **no CI**. There is no artifact that
says *this exact change, against this exact reference, passed these exact checks, and here is
the audit trail.* Decisions live in slide decks and lab notebooks. SigmaFold is that artifact.

## 2. The mapping — this is the whole idea

| Coding tool | SigmaFold |
|---|---|
| repository | the locus under study |
| branch | a proposed genotype line |
| commit | one edit, with its check run |
| diff | the DNA / codon / amino-acid three-register diff |
| CI run | the seven-agent pipeline |
| required status check | the policy gate + the verifier |
| pull request / merge | a merge the gate can refuse |

If branch switching, check state, or any number on screen is hardcoded rather than computed
from a real module, the idea is not actually built. That is the bar.

## 3. Definition of done

A judge, without touching code, can:

1. See the gene-track diagram of the locus under edit
2. **Create and switch branches**, and watch the diff change
3. Read the three-register diff (DNA / codon / amino acid)
4. Drop pO₂ and watch genotypes diverge in the live simulation
5. Run the agent pipeline and see seven checks resolve, with the audit trail
6. Type into the red-team console and watch the gate block or escalate
7. **Attempt a merge and be stopped by a failing or escalated check**

Plus: view the genome in 3D, view the protein in 3D, and upload their own sequence.

## 4. Surfaces

The **app shell** is the primary frame: a three-column layout — branch rail │ agent run console
│ workspace — styled after `sprout-careers-better`'s dashboard. Three variant views are
reachable from inside it:

| Route | Variant | Idea |
|---|---|---|
| `/ide` | `ide-triptych` | a code editor. Dense, keyboard-first, reads like reviewing a PR |
| `/bench` | `lab-bench` | a lab instrument. Cell canvas as hero, checks as gauges |
| `/graph` | `graph-first` | a git client. The commit DAG is the canvas |

## 5. Branch plan

Everything converges on **`sigmafold/paramveer`**, which opens **one PR** against `main`.

```
main
 ├── variant/lab-bench        ✅ merged → /bench
 ├── variant/ide-triptych     ✅ merged → /ide
 ├── variant/graph-first      ✅ merged → /graph
 ├── chore/unslop             ✅ merged
 ├── feat/ai-harness          ✅ reached the branch via main
 ├── feat/app-shell           ✅ merged → / (the primary frame)
 ├── feat/genome-3d-upload    ✅ merged
 └── docs/demo-script-v2      ✅ merged
```

All eight are in. `sigmafold/paramveer` opens the single PR.

## 6. Status

### Done — on `main`, green

- **`lib/genome`** — genetic code, translation, indel-aware codon diff, strict validation
- **`lib/vcs`** — content-addressed objects, branches, three-way merge, best-common-ancestor
  `mergeBase`, deterministic oids
- **`lib/agents`** — seven-agent pipeline, append-only delta DAG, gate structurally second
- **`lib/cellsim`** — deterministic seeded particle model, headless
- **`lib/merge-gate`** — fail-closed check gating across every commit a merge introduces
- **`lib/safety`** — the screening policy and its tests
- **`lib/ai`** — BYOK provider layer (Gemini / Anthropic / OpenAI-compatible / CLI) + the
  narrowing guard
- Real **NCBI NM_000518.5** reference genome + `scripts/fetch-genome.mjs` + FASTA upload parsing
- Three.js protein and cell renderers; vgpu headless render harness
- CI with a safety-boundary guard; full shadcn token set; the type system

### Remaining

1. ~~`graph-first` stub drift~~ — done. All eight stub files are deleted, plus a ninth the
   checker does not scan (`src/lib/loci/index.ts`, a duplicate of the real `lib/genome/loci.ts`).
   `node scripts/check-stubs.mjs sigmafold/paramveer` exits 0 and no `TEMP STUB` file remains.
2. ~~App shell lands, variants mount inside it~~ — done. `/` is the shell; a `VariantSwitcher`
   in all four titlebars reaches `/ide`, `/bench` and `/graph` from the chrome.
3. ~~3D genome view + upload merge~~ — done.
4. ~~Demo script and pitch~~ — done.
5. **Open findings**, carried to the PR body rather than silently fixed:
   - The pipeline is **branch-blind**. `EditPlannerAgent` resolves an edit against `loci.json`
     and the assay runs on the genotype the fixture names, so the same edit on the reference and
     on the sickle allele assays identically. The deleted stubs took a `baselineTendency`; the
     real agent contract has no equivalent. Fixing it means adding the branch's baseline
     genotype to `PipelineInput` — an agent-contract change, so it is escalated per
     CONVENTIONS §5 rather than invented. Recorded in `src/lib/demo/scenario.ts`.
   - `src/lib/fixtures/loci.ts` (graph-first) is a third fixture reader alongside the real
     `lib/genome/loci.ts`. It works and is not a stub, but it is duplication worth collapsing.
   - The app shell's own branch set never escalates, so its sign-off control has nothing to
     clear. The escalation path is exercisable on `/graph` and `/bench`.
6. ~~Review loop~~ — run; findings in the PR body.

## 7. Process — the review loop is mandatory

This was set early and must not lapse again. **Every thread, before its work merges:**

1. Finish the work and get `pnpm test && pnpm build && pnpm lint && pnpm typecheck` green
2. Delegate a review — `claudeAgent` / `claude-opus-5` / `{effort: "medium"}` / `role: "review"`
3. Brief it to follow `/Users/paramveer/.claude/skills/review-loop/SKILL.md`, review `main..HEAD`,
   and **report findings only — it must not edit source.** That skill is findings-first by
   design and a reviewer never authorises its own fixes.
4. Fix what is cheap and clearly in scope; carry the rest into the PR body as open findings

It earns its keep. The `graph-first` review found a **High-severity gate bypass** — a crafted
payload could merge a blocked branch with a forged sign-off — plus WCAG failures on the verdict
tones and a graph-layout bug found by fuzzing.

### Model routing

| Work | Model |
|---|---|
| UI and design | Opus 5.5 |
| Mechanical / throwaway code | Grok 4.6, `effort: medium`, `fastMode: true` |
| Review loop | Opus 5, `effort: medium` |
| Orchestration | Opus 5 / 5.5 |

### Working rules for threads

- **Commit incrementally.** A thread was killed mid-task; its committed work survived and its
  uncommitted work would not have. Do not sit on a large uncommitted worktree.
- Use subagents in parallel on non-overlapping files.
- **Never run `pnpm dev` in the foreground** — it does not exit. Background it, check, kill it.
- **No screen recordings.**
- Report honestly. A red test documenting a real bug beats a green suite. If you found no bugs,
  say so — do not manufacture findings.

## 8. Known risks

| Risk | State |
|---|---|
| Parallel UI builds drifted from the real `lib/` interfaces | Resolved on the integration branch. `node scripts/check-stubs.mjs sigmafold/paramveer` exits 0 — see the note below on which invocation is the gate |
| A content classifier can halt biology-adjacent threads | Hit twice. Rescope the brief to the software problem; do not model-shop to evade |
| Uncommitted work lost when a thread dies | Mitigated by committing incrementally |
| Lockfile churn across branches | Regenerate with `pnpm install --no-frozen-lockfile`, never hand-merge |

### A note on `check-stubs.mjs` invocations

The script's positional arguments are the branches **to scan**; `--base=` only sets the
reference to compare their exports against. So:

- `node scripts/check-stubs.mjs sigmafold/paramveer` → scans the integration branch. **Exits 0**,
  and reports `no files marked "TEMP STUB"`. This is the gate: it asserts the thing that
  matters, that the branch which ships has no placeholder modules and no drift.
- `node scripts/check-stubs.mjs --base=sigmafold/paramveer` → passes no branch names, so it
  discovers and scans the three `variant/*` branches, using the integration branch as the
  reference. Those branches are untouched remote refs and still contain their own stub files, so
  it reports their invented exports and **exits 1** — and will keep doing so however correct the
  integration is. The only way to make that form exit 0 is to rewrite the three variant branches
  to delete their stubs, which is a force-push to branches this thread does not own.

Both facts are true at once and neither is a build failure. If the variant branches should be
cleaned up too, that is a separate decision.
