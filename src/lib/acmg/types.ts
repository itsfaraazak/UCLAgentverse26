export type AcmgClassification =
  | 'Pathogenic'
  | 'Likely Pathogenic'
  | 'Uncertain Significance'
  | 'Likely Benign'
  | 'Benign';

export const ACMG_CLASSIFICATIONS: readonly AcmgClassification[] = Object.freeze([
  'Pathogenic',
  'Likely Pathogenic',
  'Uncertain Significance',
  'Likely Benign',
  'Benign',
]);

export type AcmgCode = 'PVS1' | 'PS1' | 'PM2' | 'PP3' | 'PP1' | 'BA1' | 'BS1' | 'BP4';

/**
 * The single-field evidence lines `scoreAcmg` reads. Field names follow the
 * source prototype's `acmg_inputs`, camel-cased.
 */
export interface AcmgInputs {
  /** Allele frequency in a population database, in [0, 1]. */
  readonly populationFrequency: number;
  readonly isNullVariantInLofGene: boolean;
  readonly matchesKnownPathogenicAaChange: boolean;
  /** Aggregate in-silico deleteriousness score, in [0, 1]. */
  readonly inSilicoDeleteriousScore: number;
  readonly segregatesWithDisease: boolean;
}

/**
 * One row of the replayable trail. `weight` is the points this criterion
 * actually contributed — 0 when unmet, and always 0 for BA1, which acts by
 * override rather than by points.
 */
export interface AcmgCriterion {
  readonly code: AcmgCode;
  readonly met: boolean;
  readonly weight: number;
  readonly note: string;
}

export interface AcmgResult {
  readonly classification: AcmgClassification;
  readonly points: number;
  readonly criteria: readonly AcmgCriterion[];
}

export function isAcmgClassification(value: unknown): value is AcmgClassification {
  return typeof value === 'string' && (ACMG_CLASSIFICATIONS as readonly string[]).includes(value);
}
