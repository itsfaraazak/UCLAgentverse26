# DeltaGene

**A multi-agent, collaboratively-auditable variant classification pipeline.**
Built for UCL AgentVerse 2026 — Biotech track ("Agents for discovery: accelerating the path from lab to patient").

## The problem, for a named user

**User: a clinical lab geneticist (or genetic counselor) deciding whether a variant found in a patient is dangerous.**

That call is harder and less settled than it looks:

- Among ordinary clinical labs submitting to ClinVar, a hypertrophic-cardiomyopathy cohort study found **45.2% of shared variants (315/695) had conflicting classifications** between labs — more than double the rate among specialist centers (SHaRe consortium data).
- A study of epilepsy genes found **47.4% of 6,292 shared ClinVar variants had some conflicting interpretation**, and **3.2% were "clinically substantial" conflicts** — crossing the exact line between "uncertain" and "likely pathogenic" that changes what a doctor does (Oliver et al. 2020).
- Even when four major labs *cooperated directly* to reconcile differences, only **88.3% of 6,169 shared variants were concordant on first look** (ClinGen/Harrison et al., presented ACMG 2016).
- The process that resolves this — **ClinGen Expert Panel curation** — works, but is small human committees applying the 2015 ACMG/AMP rubric by hand, at roughly **3–10 variants per month per panel**.
- A 2025 study found **at least 1.6% of variant classifications still used in patient records are already outdated** relative to current ClinVar, and flagged a real gap in how reclassifications get communicated back to ClinVar, patients, and providers.

Why it's not academic: the FDA's first approved CRISPR-Cas9 therapy, **Casgevy** (Vertex / CRISPR Therapeutics, approved 8 Dec 2023), treats sickle cell disease by editing a patient's own blood stem cells. Whether someone is even a candidate rests on a confident, current, correctly-classified genetic call for *HBB*. "Accelerating the path from lab to patient" is bottlenecked right here — at classification — not at the editing technology.

**DeltaGene does not replace ClinGen or a clinician.** It gives a lab a fast, transparent, multi-agent first pass at that classification, one that shows its full evidence trail, flags disagreement with any prior call instead of silently overwriting it, and *structurally* refuses to finalize a clinically consequential change without a human sign-off.

## Why "Delta"

Most tools here look like **git for genomes** (commit-snapshot version control for sequence data — see e.g. the "Gen" / "genomeGit" projects) or **Nix for bioinformatics** (BioNix: reproducible pipeline environments). Both exist already and are about static artifacts.

DeltaGene instead borrows the model behind Zed Industries' **Delta** (built on their CRDT layer, DeltaDB): humans and agents share one live thread, every edit is an atomic, attributed **delta** rather than a commit snapshot, and disagreement **forks** the thread instead of overwriting it. We apply that to a scientific claim — a variant classification — instead of a code change.

## Architecture: five agents, one shared DeltaDAG

```
EvidenceAgent → AcmgScoringAgent → ConflictAgent → ComplianceAgent → TreatmentPathwayAgent
   (citations)    (deterministic      (diff vs.      (hardware/human      (approved therapy
                   ACMG/AMP score)     prior call)     sign-off gate)       lookup)
```

Every arrow is a typed `Delta` (see `deltagene/agents/base.py` for the exact payload shapes) added to a `DeltaDAG` (`deltagene/delta_dag.py`). Nothing is ever mutated or deleted — a disagreement adds a new Delta pointing at the one it disputes, so the full reasoning chain for any number on screen is replayable via `DeltaDAG.history()`.

1. **EvidenceAgent** — gathers citations for a variant (Gemini 4 Argon via the Interactions API for the plain-language summary; falls back to a clearly-labelled stub with no API key).
2. **AcmgScoringAgent** — **deterministic, not an LLM guess.** Implements a subset of the real ACMG/AMP 2015 classification criteria using the Tavtigian et al. 2018 Bayesian point-based refinement (published point values: PVS1 = +8, PS1-equivalent = +4, PM2 = +2, PP3/PP1-equivalent = +1 each, BA1 = stand-alone Benign, BS1-equivalent = −4, BP4 = −1). This is the judge-checkable "science and evaluation" layer.
3. **ConflictAgent** — compares the new call against any existing classification for that variant and flags whether the disagreement **crosses an actionable threshold** (the same Uncertain-Significance ↔ Likely-Pathogenic line the Oliver et al. study measured).
4. **ComplianceAgent** — if the conflict crosses that threshold, it **blocks** and arms a physical sign-off gate (see Hardware below); a clean first-pass classification auto-clears with no human needed. Compliance is a structural gate in the pipeline, not a bolted-on disclaimer.
5. **TreatmentPathwayAgent** — once a classification is both pathogenic and signed off, looks up a small curated table of real, regulator-approved therapies (currently: Casgevy for *HBB*) to make the clinical stakes concrete.

## Hardware: a real human-in-the-loop gate

From the kit (Arduino Uno Q / ESP32 + breadboard, LEDs, button): a red LED lights when the ComplianceAgent blocks a classification pending review; a human must physically press a button to approve it, turning it green. See `deltagene/hardware/HARDWARE.md` for wiring and flashing. **If no board is plugged in, the pipeline automatically falls back to a terminal-prompt simulator with the identical interface** — the hardware is a physical demo prop for "keep a human in control," not a dependency.

## Data and citations

All variant fixtures in `deltagene/data/sample_variants.json` are either (a) the single well-known public-domain *HBB* sickle-cell allele (rs334), used purely as a pedagogical example, or (b) explicitly synthetic fixtures labelled `"label": "synthetic-illustrative"`, invented to demonstrate a documented statistical pattern from the literature cited above. **No real patient data is used anywhere in this project.**

| Claim | Source |
|---|---|
| 45.2% lab discordance in HCM variants | SHaRe consortium (hypertrophic cardiomyopathy ClinVar study) |
| 47.4% conflict / 3.2% clinically substantial conflict in epilepsy genes | Oliver et al. 2020 |
| 88.3% → 91.7% concordance after 4-lab reconciliation | Harrison et al., ClinGen, presented ACMG 2016 |
| ClinGen panel throughput ~3–10 variants/month | NICHD PAR-23-199 FAQ |
| ≥1.6% of EHR variant calls outdated vs. current ClinVar | "Imprecision medicine" study, 2025 (PMID on request) |
| ACMG/AMP point values (PVS1=8, PS=4, PM=2, PP=1, BA1/BS1/BP4) | Tavtigian et al. 2018, *Genetics in Medicine* |
| Casgevy mechanism and FDA approval (8 Dec 2023) | FDA approval letter, fda.gov/media/175179 |

## Models used

- **`gemini-4-argon`** — lead reasoning/orchestration, Evidence and Treatment-Pathway agent narration (Interactions API, `thinking_level="medium"`).
- Deterministic agents (ACMG scoring, conflict detection, compliance gating) are **plain Python, zero LLM calls** — intentionally, since this is the verification layer the hackathon's rules require and the one a judge can actually re-derive by hand.

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # use a venv -- some systems' bare `pip` isn't usable
.venv/bin/python -m pytest deltagene/tests -q          # unit tests for the deterministic agents
DELTAGENE_AUTO_APPROVE=1 .venv/bin/python -m deltagene.demo   # non-interactive full run
.venv/bin/python -m deltagene.demo                      # interactive: press the physical button, or type y/N, at the compliance gate
```

No `GEMINI_API_KEY`? Everything still runs — LLM calls degrade to a labelled `[stub]` string, and the ACMG/conflict/compliance agents never touch an LLM at all.

## Limits and safeguards (read before you believe a number)

- This **does not** get classifications into real ClinVar and **does not** replace a clinical geneticist's judgment — it accelerates a first pass and makes the disagreement visible.
- The ACMG agent implements a small, honestly-documented subset of the full criteria (not all ~28), computed only from the fields present in the synthetic fixtures. Treat it as a demonstration of a real, checkable rule engine, not a certified clinical tool. On the headline *HBB* example this scoped rubric lands on **"Likely Pathogenic,"** one notch below the "Pathogenic" call real ClinVar gives HbS using additional case-control and functional-study criteria that are intentionally out of scope here — the rubric is conservative by design, not wrong: it flags the danger without overclaiming certainty it hasn't earned.
- The Treatment-Pathway table is a hand-curated illustrative lookup, not a live clinical database.
- No real patient data, ever. Synthetic fixtures are explicitly labelled as such in `sample_variants.json`.
