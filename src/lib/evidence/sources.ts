/**
 * Licence metadata for every upstream source, verified 2026-11-08 (see
 * LICENCES.md for the evidence behind each line). MyVariant.info attaches a
 * `_license` short link to each block; these are the pages those links point
 * to, or a more specific licence statement where the short link only reaches
 * a project home page.
 */

export interface SourceLicence {
  readonly name: string;
  readonly licence: string;
  readonly licenceUrl: string;
}

export const MYVARIANT: SourceLicence = {
  name: 'MyVariant.info',
  licence:
    'Free public API (BioThings, Scripps Research; code Apache-2.0). Each aggregated source keeps its own terms.',
  licenceUrl: 'https://myvariant.info/terms/',
};

export const CLINVAR: SourceLicence = {
  name: 'ClinVar (NCBI)',
  licence:
    'NCBI places no restrictions on use or redistribution of molecular data (US Government work); submitters may retain rights.',
  licenceUrl: 'https://www.ncbi.nlm.nih.gov/home/about/policies/',
};

export const DBSNP: SourceLicence = {
  name: 'dbSNP (NCBI)',
  licence: CLINVAR.licence,
  licenceUrl: CLINVAR.licenceUrl,
};

export const GNOMAD: SourceLicence = {
  name: 'gnomAD (v2.1.1, via MyVariant.info)',
  licence: 'Primary gnomAD data: CC0 1.0 public domain dedication; attribution to gnomAD requested.',
  licenceUrl: 'https://gnomad.broadinstitute.org/terms',
};

export const ALPHAMISSENSE: SourceLicence = {
  name: 'AlphaMissense (via dbNSFP 4.8a)',
  licence:
    'AlphaMissense predictions: CC BY 4.0, (c) 2023 DeepMind Technologies Limited (Cheng et al. 2023, Science 381:eadg7492). ' +
    'Delivered through dbNSFP, whose compilation is for academic use.',
  licenceUrl: 'https://github.com/google-deepmind/alphamissense#alphamissense-predictions-license',
};

export const SNPEFF: SourceLicence = {
  name: 'snpEff (v4.3k, via MyVariant.info)',
  licence: 'Computed annotation from snpEff software (LGPLv3 at v4.3k; MIT from later releases).',
  licenceUrl: 'https://github.com/pcingola/SnpEff',
};

export const CADD: SourceLicence = {
  name: 'CADD (via MyVariant.info)',
  licence: 'CADD scores are free for non-commercial use; commercial use requires a licence from the University of Washington.',
  licenceUrl: 'https://cadd.gs.washington.edu/contact',
};

export const EUROPE_PMC: SourceLicence = {
  name: 'Europe PMC',
  licence:
    'Free REST API (commercial use permitted). Article content stays under each publisher/author copyright; only titles and links are shown.',
  licenceUrl: 'https://europepmc.org/Copyright',
};
