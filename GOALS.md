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
 ├── variant/graph-first      ⏳ merging → /graph
 ├── chore/unslop             ⏳ pending
 ├── feat/ai-harness          ⏳ pending   (genome + BYOK providers)
 ├── feat/app-shell           ⏳ pending
 ├── feat/genome-3d-upload    ⏳ pending
 └── docs/demo-script-v2      ⏳ pending
```

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

1. **`graph-first` stub drift** — 16 invented exports across `agents` + `cellsim`. *Blocks the build.*
2. App shell lands, variants mount inside it
3. 3D genome view + upload merge
4. `lib/ai` guard tests + three feature wirings
5. Demo script and pitch
6. **Review loop on every branch** (see §7), then the single PR

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
| Parallel UI builds drifted from the real `lib/` interfaces | `scripts/check-stubs.mjs` detects it; must exit 0 before merge |
| A content classifier can halt biology-adjacent threads | Hit twice. Rescope the brief to the software problem; do not model-shop to evade |
| Uncommitted work lost when a thread dies | Mitigated by committing incrementally |
| Lockfile churn across branches | Regenerate with `pnpm install --no-frozen-lockfile`, never hand-merge |
