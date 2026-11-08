/**
 * Hand-curated illustrative lookup, not a live clinical database.
 * Casgevy's mechanism (BCL11A enhancer edit raising HbF) is not the same as
 * any edit modelled in this repo — the table states what is approved, it does
 * not endorse an edit.
 */

import table from '@/data/therapy-table.json';
import type { AcmgClassification } from './types';

export interface TherapyEntry {
  readonly provenance: 'public-reference' | 'synthetic-illustrative';
  readonly name: string;
  readonly approvedFor: string;
  readonly mechanism: string;
  readonly developer: string;
  readonly citation: string;
}

export type TherapyLookup =
  | {
      readonly kind: 'not-actionable';
      readonly gene: string;
      readonly classification: AcmgClassification;
      readonly therapies: readonly [];
      readonly note: string;
      readonly disclaimer: string;
    }
  | {
      readonly kind: 'no-entry';
      readonly gene: string;
      readonly classification: AcmgClassification;
      readonly therapies: readonly [];
      readonly note: string;
      readonly disclaimer: string;
    }
  | {
      readonly kind: 'matched';
      readonly gene: string;
      readonly classification: AcmgClassification;
      readonly therapies: readonly TherapyEntry[];
      readonly note: string;
      readonly disclaimer: string;
    };

const ACTIONABLE: ReadonlySet<AcmgClassification> = new Set([
  'Pathogenic',
  'Likely Pathogenic',
]);

const EMPTY_THERAPIES: readonly [] = Object.freeze([]);

const PROVENANCE = new Set(['public-reference', 'synthetic-illustrative']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`therapy-table.json: ${field} must be a non-empty string`);
  }
  return value;
}

function parseEntry(value: unknown, path: string): TherapyEntry {
  if (!isRecord(value)) {
    throw new Error(`therapy-table.json: ${path} must be an object`);
  }
  const provenanceRaw = requireString(value.provenance, `${path}.provenance`);
  if (!PROVENANCE.has(provenanceRaw)) {
    throw new Error(
      `therapy-table.json: ${path}.provenance must be public-reference or synthetic-illustrative`,
    );
  }
  const provenance: TherapyEntry['provenance'] =
    provenanceRaw === 'public-reference' ? 'public-reference' : 'synthetic-illustrative';
  return Object.freeze({
    provenance,
    name: requireString(value.name, `${path}.name`),
    approvedFor: requireString(value.approvedFor, `${path}.approvedFor`),
    mechanism: requireString(value.mechanism, `${path}.mechanism`),
    developer: requireString(value.developer, `${path}.developer`),
    citation: requireString(value.citation, `${path}.citation`),
  });
}

function parseTable(value: unknown): {
  readonly disclaimer: string;
  readonly byGene: ReadonlyMap<string, readonly TherapyEntry[]>;
} {
  if (!isRecord(value)) {
    throw new Error('therapy-table.json: root must be an object');
  }
  const disclaimer = requireString(value._disclaimer, '_disclaimer');
  requireString(value._source, '_source');
  if (!isRecord(value.byGene)) {
    throw new Error('therapy-table.json: byGene must be an object');
  }
  const byGene = new Map<string, readonly TherapyEntry[]>();
  for (const [gene, entries] of Object.entries(value.byGene)) {
    if (!Array.isArray(entries)) {
      throw new Error(`therapy-table.json: byGene.${gene} must be an array`);
    }
    const parsed = Object.freeze(entries.map((entry, i) => parseEntry(entry, `byGene.${gene}[${i}]`)));
    byGene.set(gene.toUpperCase(), parsed);
  }
  return { disclaimer, byGene };
}

const parsed = parseTable(table);

export const THERAPY_TABLE_DISCLAIMER: string = parsed.disclaimer;

function copyTherapies(entries: readonly TherapyEntry[]): readonly TherapyEntry[] {
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
}

export function lookupTherapies(gene: string, classification: AcmgClassification): TherapyLookup {
  const symbol = gene.trim().toUpperCase();
  const disclaimer = THERAPY_TABLE_DISCLAIMER;

  if (!ACTIONABLE.has(classification)) {
    return {
      kind: 'not-actionable',
      gene: symbol,
      classification,
      therapies: EMPTY_THERAPIES,
      note: `Classification is '${classification}' -- not actionable, no lookup performed.`,
      disclaimer,
    };
  }

  const entries = parsed.byGene.get(symbol);
  if (entries === undefined || entries.length === 0) {
    return {
      kind: 'no-entry',
      gene: symbol,
      classification,
      therapies: EMPTY_THERAPIES,
      note: `No approved therapy on record for ${symbol} in therapy-table.json.`,
      disclaimer,
    };
  }

  const n = entries.length;
  const noun = n === 1 ? 'therapy' : 'therapies';
  return {
    kind: 'matched',
    gene: symbol,
    classification,
    therapies: copyTherapies(entries),
    note: `${n} regulator-approved ${noun} on record for ${symbol} (illustrative lookup, not a live clinical database).`,
    disclaimer,
  };
}
