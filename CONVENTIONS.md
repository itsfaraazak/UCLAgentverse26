# Conventions

How code is written in this repository. [`SPEC.md`](./SPEC.md) is the contract;
[`GOALS.md`](./GOALS.md) is the goal and status; this is the house style.

Nine agents and several models have touched this codebase. Consistency is not decoration here —
it is what keeps the result from reading as nine different projects stapled together.

---

## 1. Module design

Design **deep modules**: a lot of behaviour behind a small interface, placed at a clean seam,
testable through that interface.

Use this vocabulary exactly. Do not substitute "component", "service", "API" or "boundary".

- **Module** — anything with an interface and an implementation. Scale-agnostic: a function, a
  class, a directory.
- **Interface** — *everything a caller must know to use the module correctly*: the type
  signature, but also invariants, ordering constraints, error modes, and required config. Wider
  than "the exported types".
- **Depth** — leverage at the interface. How much behaviour a caller gets per unit of interface
  they must learn. Deep = small interface, lots behind it.
- **Seam** — the place where you can change behaviour without editing in that place. Where the
  interface lives. Say *seam*, not *boundary*.
- **Adapter** — a concrete thing satisfying an interface at a seam. Describes role, not substance.

### Rules that follow

- **The deletion test.** If deleting a module makes complexity vanish, it was a pass-through. If
  complexity reappears across N callers, it earned its keep.
- **The interface is the test surface.** Tests and callers cross the same seam. Needing to test
  *past* the interface means the module is the wrong shape.
- **One adapter is a hypothetical seam; two is a real one.** Do not introduce a seam until
  something actually varies across it.
- **Accept dependencies, do not construct them.** `runAssay(plan, sim)` over `runAssay(plan)`
  that news up a simulation inside.
- **Return results, do not mutate arguments.** `diffSequences(ref, alt): DiffRow[]`, not a
  function that writes into something you passed in.

### Worked examples in this repo

| Module | Interface | Why it is deep |
|---|---|---|
| `lib/vcs` | `Repo` with `commit`/`branch`/`merge`/`log`/`mergeBase` | Content addressing, canonical JSON hashing, ancestry walking and three-way merge all sit behind a handful of methods |
| `lib/merge-gate` | `evaluateMerge({repo, ours, theirs, checks})` | One call decides content conflicts, missing checks, failures, and sign-off state. The layering is deliberate: `Repo` stays a content primitive; policy lives above it |
| `lib/cellsim` | `step()` / `run()` + three metrics | A whole particle model behind a headless interface with no DOM |
| `lib/ai/guard` | `combineVerdicts`, `assertTransmissible` | The entire narrowing invariant reduces to an ordering and a throw |

## 2. Layering

```
src/lib/**          pure, framework-free. No React, no DOM, no Next imports.
src/components/**   React. Props-driven, layout-agnostic.
src/app/**          routes, server actions, the trust boundary for user input.
```

- `lib/` must be unit-testable in a plain node environment, and the simulation must run headless.
- Computation belongs in `lib/`; rendering belongs in `components/`. The simulation computes, the
  component draws. Graph *layout* is pure logic and belongs in a framework-free module with tests.
- Components take props and assume nothing about the surrounding page. They get embedded in
  three different variant layouts.

## 3. TypeScript

- **Strict.** No `any`. No non-null `!` to silence the compiler. No `@ts-ignore`.
- If a third-party package's types are poor, write a narrow local declaration file next to the
  code that needs it — do not reach for `any`.
- Prefer discriminated unions over boolean flags. `MergeDecision` is the model: each failure
  carries exactly the data that failure needs.
- Mark things `readonly` where they are not meant to change.

## 4. Determinism

Several modules exist to be re-derivable by hand. Treat determinism as a correctness property.

- **Never `Math.random()`.** Seed a PRNG you control (mulberry32) and print the seed on failure.
- No wall-clock time inside anything hashed or replayed. `Delta.createdAt` is a logical counter,
  not `Date.now()`.
- Canonical JSON before hashing: recursively sorted keys, no incidental whitespace. The same
  logical object must hash identically across processes and key insertion orders.
- Same seed plus same params must produce byte-identical metrics. Test it.

## 5. Testing

- Vitest. Co-located `*.test.ts`. Property/fuzz suites are `*.property.test.ts`.
- Test through the interface, not past it.
- **Assert ordering and direction, not magic numbers**, for simulation behaviour: "sickle
  occludes more than reference at low pO₂" survives tuning; `occlusion === 0.73` does not.
- Property tests roll their own seeded loop — **no new test dependencies**, because a lockfile
  change conflicts across parallel branches.
- **Do not weaken a test to make it pass.** A red test documenting a real bug is a better
  outcome than a green suite.
- If the spec is silent on something a test exposes, **escalate it — do not invent policy.**
  Mark the test `.todo`/`.skip` with a comment and report it. Five such escalations became
  SPEC §4.6.

## 6. Safety boundary

See [`SPEC.md` §7](./SPEC.md). These are engineering constraints, not preferences.

- **`src/lib/safety/policy.ts` is never modified.** Consume it. CI fails any PR touching
  `src/lib/safety/`. If you think the policy is wrong, report it.
- The gate is **structural**: it runs at pipeline position 2 and a `block` verdict terminates
  the run *before* any downstream agent computes. It is not a disclaimer printed beside results
  that were computed anyway.
- **Never echo refused input.** When a screen result is `redacted`, store and render the policy
  category and a generic reason only. Not the user's text — not in the UI, the DOM, the logs, or
  the delta trail. Hash it or discard it.
- **Escalation requires a human.** Nothing auto-approves. Sign-off derives its role from policy;
  it is never supplied by the client. *(A review found exactly this bypass: a client-supplied
  `role` field let a crafted payload forge a sign-off.)*
- **Fail closed.** A missing or pending check does not merge. Absence of evidence is not a pass.
- The repository contains **no construct-design content** — no guides, primers, vectors,
  protocols or wet-lab parameters — and no pathogen or toxin material.
- **Label every fixture** `public-reference` or `synthetic-illustrative`. No real patient data,
  no invented accession numbers, no fabricated performance claims.

### AI-specific

- **AI may only narrow, never unlock.** The deterministic `screen()` is authoritative.
- Verdicts combine by **maximum restriction**. A model saying "allow" against a lexical `block`
  yields `block`.
- A model **never mints a verdict** — it selects a label from a closed set and the verdict is
  read from the frozen policy table. An unrecognised label resolves to the restrictive default.
- **Screen before transmit.** Nothing `redacted` leaves the process.
- Model output is untrusted data: parse strictly against a schema, never `eval`, never let a
  response select a code path by name.
- The gate and the verifier stay deterministic. No model in that path.
- **Model id is `gemini-4-argon`.** Never a `*-flash` variant, not even as a fallback. If it
  errors, surface the error and degrade to the labelled non-AI path.

## 7. Honesty in the product

The project's credibility rests on saying what it does *not* do.

- The simulation is **illustrative and uncalibrated**. Say so where its numbers appear.
- Structural annotations are **curated textbook summaries, not predictions**. Surface the
  fixture's own `limitation` text.
- The screen is a **deterministic lexical gate** that over-blocks and can be evaded by
  paraphrase. It belongs *in front of* a human reviewer, never in place of one.
- `mergeBase` picks the lowest oid among best common ancestors: **deterministic and symmetric,
  not correct in the full sense** for criss-cross histories. Documented, not hidden.
- Never claim a verification you did not run. If tests fail, say so with the output.

## 8. UI

- **Minimal.** Hairline rules (`.hairline`), not boxes. Neutral greys, one accent, almost no
  shadows. Dense rows with generous internal padding. Let type and spacing work.
- **shadcn/ui** for every primitive. `src/components/ui/**` is generated — do not hand-edit.
- **lucide-react** for every icon, consistently sized. **No emoji as icons.**
- **Both themes deliberate.** Not one theme plus an inverted copy.
- Colour carries meaning, never decoration — and **never as the only signal.** Verdict tones
  always pair with an icon and a text label.
- Accessible: keyboard reachable, visible focus rings, labelled controls, **AA contrast in both
  themes**, `prefers-reduced-motion` honoured. A WebGL canvas needs a real text alternative.
- **Nothing hardcoded.** Every value on screen comes from a real module call.

### Typography

| Face | Where | Rule |
|---|---|---|
| **Plus Jakarta Sans** | UI text | the default |
| **Poppins** 500/600 | `.font-display` — wordmark, headings | single-ish weight; **never `font-bold`** |
| **JetBrains Mono** | `.seq` — sequence text **only** | ligatures off |

**Always use `.seq` for nucleotides and amino acids, never plain `font-mono`.** JetBrains Mono
ships coding ligatures that visually fuse adjacent characters — catastrophic when the whole
point is reading one base at a time.

Not Inter. Not Helvetica.

### 3D

- Three.js. Prefer `WebGPURenderer`, fall back to `WebGLRenderer`, detect at runtime. If WebGPU
  silently lands on its internal WebGL backend, discard it rather than report it as WebGPU.
- `InstancedMesh` for repeated geometry.
- **Dispose everything on unmount** — geometries, materials, meshes, controls, observers,
  renderer; cancel animation frames; abort in-flight fetches. A leaked context across route
  switches kills the demo.
- **Graceful degradation is mandatory.** A failed fetch, missing GPU, or library load error
  renders an informative text fallback with a working retry. Never a blank box, never an
  unhandled rejection. Test the failure paths.
- Animate from real `step()` calls. Never fake motion with a CSS loop.

## 9. Git

- Conventional commits. Small and reviewable.
- **Commit incrementally.** Work that is not committed is lost when a thread dies.
- Commit messages explain *why*, not what the diff shows. Record the reasoning that would
  otherwise be lost — especially a decision someone might later "fix".
- Co-author trailers name the model that wrote the code.
- Regenerate the lockfile (`pnpm install --no-frozen-lockfile`); never hand-merge it.
- `scripts/check-stubs.mjs` must exit 0 before any variant merges.

## 10. Comments

- Comment the **why**, never the what. A comment restating the next line is noise.
- No JSDoc that re-types the signature in prose.
- **Never delete a comment that records a limitation, a safety rationale, a spec reference, or a
  trap.** Those are the most valuable lines in the file.
- No changelog comments in source — that is what git history is for.
- No marketing words: *comprehensive, robust, seamless, production-ready, blazing*.

## 11. Before you report done

```
pnpm install
pnpm test
pnpm build      # includes typecheck
pnpm lint
pnpm typecheck
```

All must pass. **Never run `pnpm dev` in the foreground** — it does not exit. Background it on a
free port, check, kill it.

### Why `typecheck` needs Next's generated types

`src/app/layout.tsx` uses `LayoutProps<"/">`, one of Next's route-aware global helpers. Those
live in `.next/types/`, which `tsconfig.json` includes, and Next writes them during `next dev`,
`next build` or `next typegen`. So on a clean checkout, `tsc --noEmit` on its own fails with
`Cannot find name 'LayoutProps'` — a missing generated file, not a type error in the code.

A `pretypecheck` script runs `next typegen` (about four seconds, no full build), so
`pnpm typecheck` passes on its own from a fresh clone and the order above is a convenience
rather than a requirement. If you ever see that error, you are running `tsc` directly: run
`pnpm typecheck`, or `next typegen` first.

Report what actually happened. If a step was skipped, say so.
