# Evidence sources and licences

Verified 2026-11-08. The strings shipped with every `SourceRef` live in [`sources.ts`](./sources.ts).

| Source | What we use | Licence | Terms |
|---|---|---|---|
| MyVariant.info (BioThings, Scripps Research) | Variant resolution and the aggregated annotation below | Free public API; code Apache-2.0; each aggregated source keeps its own terms | https://myvariant.info/terms/ |
| gnomAD v2.1.1 | Genome and exome allele frequency | CC0 1.0; attribution requested | https://gnomad.broadinstitute.org/terms |
| AlphaMissense (via dbNSFP 4.8a) | Missense pathogenicity score (Cheng et al. 2023, *Science* 381:eadg7492) | Predictions CC BY 4.0, (c) 2023 DeepMind Technologies Limited; dbNSFP compilation for academic use | https://github.com/google-deepmind/alphamissense#alphamissense-predictions-license |
| ClinVar (NCBI) | Held-out reference classification and review status | No restrictions on use or redistribution (US Government work); submitters may retain rights | https://www.ncbi.nlm.nih.gov/home/about/policies/ |
| dbSNP (NCBI) | rsIDs | As ClinVar | https://www.ncbi.nlm.nih.gov/home/about/policies/ |
| snpEff v4.3k (via MyVariant.info) | Consequence and HGVS annotation | LGPLv3 at v4.3k (MIT in later releases) | https://github.com/pcingola/SnpEff |
| CADD (via MyVariant.info) | PHRED score where present (hg19 only, so usually absent on hg38) | Free for non-commercial use | https://cadd.gs.washington.edu/contact |
| Europe PMC | Paper titles, journals, years and links | Free REST API, commercial use permitted; article content under publisher or author copyright | https://europepmc.org/Copyright |

Shipped snapshots in `src/data/evidence-cache/` are verbatim API responses for the demo variants, kept so the demo runs without network access. The UI marks any value served from them as cached.
