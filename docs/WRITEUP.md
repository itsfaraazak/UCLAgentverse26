# SigmaFold Workbench: one-page write-up

**Version control where clinical scientists and AI agents interpret genetic variants together.**

## The problem and who it helps

Getting from a sequenced patient to a diagnosis runs through **variant interpretation**. A clinical scientist in a genomic diagnostic lab (in the UK, an NHS Genomic Laboratory Hub) takes each candidate variant, gathers population frequency, computational predictions, prior classifications and literature, and applies the ACMG/AMP criteria to call it pathogenic, benign or uncertain. It is slow, expert work, and the reasoning is scattered across spreadsheets, tools and emails. AI predictors such as AlphaMissense help, but labs need to know exactly what a model contributed, where it disagrees with established evidence, and who took responsibility for the final call.

**Our user** is that clinical scientist and the colleague who checks their work. **The bottleneck** is assembling and auditing the evidence for each variant. SigmaFold turns this into a reviewable workflow: an agent assembles the evidence and a draft classification in about a minute, and a human reviews, adjusts and signs off on a shared record.

## What we built

A web workbench built on an append-only, content-addressed version history (in the spirit of Zed's DeltaDB):

1. **A human prompts on a branch,** for example "Interpret BRCA1 c.5266dupC for a patient with a family history of breast cancer". Judges can type any rsID or gene plus HGVS.
2. **A deterministic safety gate screens the request before any model call.** Interpreting an observed variant is allowed for any gene. Edit proposals go through the project's biosafety policy: disrupting a tumour suppressor is refused, and requests for guides, primers or protocols are blocked and their text never stored.
3. **A Gemini agent (`gemini-4-argon`, native function calling) plans and calls tools.** These are `lookup_variant` (MyVariant.info: gnomAD, AlphaMissense, consequence), `search_literature` (Europe PMC) and, for edits, `propose_correction`.
4. **Required checks run automatically on every evidence fetch,** and the model can't skip them: a deterministic ACMG classifier (Tavtigian 2018 points), then a comparison against ClinVar, which is held out as the answer key.
5. **Humans collaborate on the deltas.** They comment, ask the agent follow-ups, dismiss a criterion with a reason, or add family segregation evidence; the classifier re-runs and the history forks rather than being overwritten.
6. **The merge gate decides what reaches the case record.** Merging into `main` requires a passed safety gate, a classification, acknowledgement of any major ClinVar disagreement, and a non-stale sign-off by a named human with a role.

## Data

Real public reference data only, with no patient data. The table below lists each source and its licence (verified; full detail in `src/lib/evidence/LICENCES.md`):

| Source | Licence |
|---|---|
| gnomAD v2.1.1 | CC0 |
| AlphaMissense | CC BY 4.0, via dbNSFP (academic use) |
| ClinVar and dbSNP | NCBI, unrestricted |
| Europe PMC | Titles and links only |
| MyVariant.info | API aggregator |

Each value in the UI shows its source, licence and retrieval time. Demo variants ship as a labelled offline snapshot. No synthetic data is presented as real.

## How we evaluated it

We ran 200 ClinVar variants with 2+ star expert consensus (100 pathogenic/likely pathogenic, 100 benign/likely benign; 157 genes; 120 missense, 80 loss-of-function). ClinVar was hidden from every method. We compared against two baselines (`pnpm eval`, `/evaluation`):

| Method | Coverage | Accuracy when it called | Pathogenic called benign |
|---|---|---|---|
| SigmaFold classifier | 15.5% | 100% (31/31) | **0** |
| AlphaMissense alone | 58.5% | 93.2% (109/117) | **5** |
| Frequency alone | 11.5% | 100% (23/23) | 0 |

SigmaFold never gave false reassurance, but it is conservative and leaves most variants as Uncertain Significance for a human. In the product, all 82 pathogenic variants it left uncertain would have been flagged as a major ClinVar disagreement requiring sign-off. Agreement with ClinVar is partly circular (curators use frequency and predictors too), and 2-star variants are easier than a real diagnostic queue.

## Limits and safeguards

| Risk | Mitigation |
|---|---|
| The model invents evidence or citations | Tools are the only source of facts; every claim cites a delta id; the evidence values are rendered from data, not model text |
| The model changes a clinical decision | The classification is deterministic; only humans can dismiss criteria, sign off or merge (enforced server-side) |
| An AI predictor is confidently wrong (for example AlphaMissense calls sickle-cell rs334 benign) | The predictor is supporting evidence only; the ClinVar reference check blocks merge on major disagreement until a human signs off with a rationale |
| Stale approval | A newer classification makes an older sign-off stale; merge is refused |
| Misuse for harmful edits | The deterministic gate runs before any model call; refused text is never stored; the policy file is CI-guarded |
| Outages during use | A deterministic fallback pipeline and a labelled evidence cache |
| Overclaiming | 8 of ~28 ACMG criteria; not a clinical tool; identity is self-declared in this prototype |

## Next step to real use

Pilot as a "second reader" in one lab's interpretation queue:
- Add the remaining ACMG criteria, with ClinGen-calibrated computational thresholds.
- Add real identity and audit export.
- Export signed records to the lab's reporting system and as ClinVar submissions.
- Measure scientist time per variant against the current workflow.
