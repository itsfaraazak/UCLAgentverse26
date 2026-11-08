/**
 * Typed access to `data/acmg-variants.json`, the evidence inputs the
 * classifier reads. Records are keyed by the `loci.json` variant id so the
 * classification agent can look up whatever the edit planner resolved.
 *
 * The JSON is validated from `unknown` at load: a malformed record throws
 * rather than reaching `scoreAcmg` with a missing field.
 */

import file from '@/data/acmg-variants.json';
import type { AcmgClassification, AcmgInputs } from './types';
import { isAcmgClassification } from './types';

export type FixtureProvenance = 'public-reference' | 'synthetic-illustrative';

export interface AcmgVariantRecord {
  readonly variantId: string;
  readonly provenance: FixtureProvenance;
  readonly gene: string;
  readonly hgvs: string;
  readonly note: string;
  readonly acmgInputs: AcmgInputs;
  /** The call already on record. Simulated from the fixture, not ClinVar. */
  readonly priorClassification: AcmgClassification | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseInputs(value: unknown, where: string): AcmgInputs {
  if (
    !isObject(value) ||
    typeof value.populationFrequency !== 'number' ||
    typeof value.isNullVariantInLofGene !== 'boolean' ||
    typeof value.matchesKnownPathogenicAaChange !== 'boolean' ||
    typeof value.inSilicoDeleteriousScore !== 'number' ||
    typeof value.segregatesWithDisease !== 'boolean'
  ) {
    throw new Error(`acmg-variants.json: ${where} has malformed acmgInputs`);
  }
  return Object.freeze({
    populationFrequency: value.populationFrequency,
    isNullVariantInLofGene: value.isNullVariantInLofGene,
    matchesKnownPathogenicAaChange: value.matchesKnownPathogenicAaChange,
    inSilicoDeleteriousScore: value.inSilicoDeleteriousScore,
    segregatesWithDisease: value.segregatesWithDisease,
  });
}

export function parseAcmgRecord(value: unknown, where = 'record'): AcmgVariantRecord {
  if (!isObject(value)) throw new Error(`acmg-variants.json: ${where} is not an object`);
  const { variantId, provenance, gene, hgvs, note, priorClassification } = value;
  if (typeof variantId !== 'string' || variantId.length === 0) {
    throw new Error(`acmg-variants.json: ${where} is missing variantId`);
  }
  // CONVENTIONS §6: every fixture is labelled. An unlabelled record is refused.
  if (provenance !== 'public-reference' && provenance !== 'synthetic-illustrative') {
    throw new Error(`acmg-variants.json: ${variantId} has no valid provenance label`);
  }
  if (typeof gene !== 'string' || typeof hgvs !== 'string' || typeof note !== 'string') {
    throw new Error(`acmg-variants.json: ${variantId} is missing gene/hgvs/note`);
  }
  if (priorClassification !== null && !isAcmgClassification(priorClassification)) {
    throw new Error(`acmg-variants.json: ${variantId} has an unknown priorClassification`);
  }
  return Object.freeze({
    variantId,
    provenance,
    gene,
    hgvs,
    note,
    acmgInputs: parseInputs(value.acmgInputs, variantId),
    priorClassification,
  });
}

function parseFile(raw: unknown): readonly AcmgVariantRecord[] {
  if (!isObject(raw) || !Array.isArray(raw.variants)) {
    throw new Error('acmg-variants.json: expected a top-level "variants" array');
  }
  return Object.freeze(raw.variants.map((v: unknown, i: number) => parseAcmgRecord(v, `variants[${i}]`)));
}

export const ACMG_VARIANT_RECORDS: readonly AcmgVariantRecord[] = parseFile(file);

export const ACMG_FIXTURE_DISCLAIMER: string = file._disclaimer;
