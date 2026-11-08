# SigmaFold

**Version control for genetic engineering.** Open a branch, apply an edit to a genotype, and a
multi-agent CI pipeline decides whether it passes — structurally, functionally, and on
biosafety grounds — before it can be merged.

Built for UCL AgentVerse 2026, Biotech track.

> Companion to the `feature/deltagene-prototype` branch, which holds the earlier Python
> variant-classification pipeline. SigmaFold deliberately reuses its "append-only DAG of
> attributed deltas" vocabulary.

---

## Read this first

**[`SPEC.md`](./SPEC.md) is the contract.** It defines the module boundaries, the agent
pipeline, the three UI variants, the engineering standards, and — in §7 — a non-negotiable
safety boundary. Anyone (human or agent) working on this repo reads it before writing code.

## What it does

| Surface | What it shows |
|---|---|
| **Gene track diagram** | SVG map of the locus under edit, zoomable to codon level |
| **Three-register diff** | DNA / codon / amino-acid, side by side and synchronised |
| **Live cell canvas** | Deterministic particle simulation driven by the genotype and an O₂ slider |
| **Agent CI panel** | Seven checks resolving in order, with the full delta audit trail |
| **Red-team console** | Free-text requests screened by a structural biosafety gate |
| **Branch + merge gate** | Real branches, real three-way merge, blocked by failing checks |

## Architecture

```
lib/genome   sequence model, genetic code, variants, diff engine
lib/vcs      content-addressed objects, branches, three-way merge   ← git for genomes
lib/agents   append-only delta DAG + the seven-agent pipeline
lib/safety   screening policy (the gate)
lib/cellsim  deterministic, headless particle simulation
```

`lib/` is pure and framework-free: no React, no DOM. The simulation runs headless so the
functional-assay agent can call it directly, and every number in the UI comes from a real
module call.

The agent pipeline runs the **biosafety gate second — before any downstream analysis** — and a
`block` verdict terminates the run. The gate is structural, not a disclaimer printed next to
results that were computed anyway.

## Variants

Three branches, same core, three genuinely different surfaces:

- `variant/ide-triptych` — a code editor. Branch tree ∥ diff ∥ CI. Keyboard-first.
- `variant/lab-bench` — a lab instrument. Cell canvas as the hero; checks as gauges.
- `variant/graph-first` — a git client. The commit DAG is the canvas.

## Stack

Next.js 16 (App Router) · TypeScript strict · Tailwind 4 · shadcn/ui (Base UI) ·
lucide-react · Vitest. No Electron — the macOS feel is CSS.

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm test       # vitest
pnpm build      # production build + typecheck
pnpm lint
```

## Honest limits

- The particle simulation is **illustrative**, tuned to read clearly on screen. It is not
  calibrated against experimental haemorheology and must not be read as predictive.
- Structural annotations are curated textbook summaries, not structure-prediction output.
- The biosafety screen is a deterministic keyword-and-registry gate, chosen so a reviewer can
  re-derive every verdict by hand. It over-blocks on innocent phrasing and can be evaded by
  paraphrase. In any real setting it belongs *in front of* a human biosafety officer, never in
  place of one.
- The ACMG classifier (`src/lib/acmg`) implements **8 of the ~28** ACMG/AMP 2015 criteria,
  using the Tavtigian et al. 2018 point values (*Genet Med* 20:1054-1060). PS1, BS1 and PP1 are
  approximated from a single input field each, not the orthogonal evidence lines the official
  codes require. Omitting the case-control and functional-study criteria makes it deliberately
  **conservative**: the *HBB* rs334 example scores *Likely Pathogenic* where ClinVar reports
  *Pathogenic*. It is a demonstration of a checkable rule engine, not a certified clinical tool,
  and the full caveat ships as `ACMG_SCOPE_LIMITATION` on every classification it emits.
- Only four of the five bands are reachable from the scoped subset: the lowest total any input
  can produce is −5, so *Likely Benign* is unreachable by points and *Benign* is reached only by
  the BA1 stand-alone rule.
- A variant's `priorClassification` **simulates** the call already on record. It is not a
  ClinVar query, and a disagreement with it is not a real inter-lab discordance.
- The therapy table (`src/data/therapy-table.json`) is a hand-curated illustrative lookup of
  publicly documented, regulator-approved therapies — not a live clinical database and not a
  substitute for a clinician or genetic counselor. It states what is approved; it does not
  endorse any edit this repository models.
- Fixtures in `src/data/loci.json`, `src/data/acmg-variants.json` and
  `src/data/therapy-table.json` are labelled `public-reference` or
  `synthetic-illustrative`. No real patient data. No construct designs, guides, primers,
  vectors or protocols appear anywhere in this repository, by policy.
- This is a hackathon prototype. It is not a clinical tool and not a biosafety control.
