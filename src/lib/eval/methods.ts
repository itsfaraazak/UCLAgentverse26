import { interpret } from '../evidence/interpret';
import type { Consequence, Interpretation, VariantEvidence } from '../evidence/types';
import { collapse, type Call } from './metrics';

export type MethodId = 'sigmafold' | 'alphamissense' | 'frequency' | 'cadd';

export interface MethodInfo {
  readonly id: MethodId;
  readonly name: string;
  readonly rule: string;
}

export const METHODS: readonly MethodInfo[] = [
  {
    id: 'sigmafold',
    name: 'SigmaFold classifier',
    rule:
      'interpret(evidence) with no human assertions: 8 scoped ACMG/AMP criteria, Tavtigian 2018 points. ' +
      'ClinVar is never visible to it.',
  },
  {
    id: 'alphamissense',
    name: 'Baseline A: AlphaMissense alone',
    rule: 'Missense only. Max score > 0.564 = P/LP, < 0.34 = B/LB, otherwise VUS (Cheng et al. 2023). No score or not missense = no call.',
  },
  {
    id: 'frequency',
    name: 'Baseline B: population frequency alone',
    rule: 'gnomAD max AF > 5% = B/LB (BA1); > 1% = B/LB (BS1); otherwise VUS. Rarity alone cannot argue pathogenic.',
  },
  {
    id: 'cadd',
    name: 'Baseline C: CADD alone',
    rule: 'CADD PHRED >= 20 = P/LP, < 10 = B/LB, otherwise VUS. No score = no call.',
  },
];

export type ConsequenceGroup = 'missense' | 'lof' | 'other';

const LOF: ReadonlySet<Consequence> = new Set(['stop_gained', 'frameshift', 'splice', 'start_lost']);

export function consequenceGroup(c: Consequence): ConsequenceGroup {
  if (c === 'missense') return 'missense';
  return LOF.has(c) ? 'lof' : 'other';
}

export const AM_PATHOGENIC_ABOVE = 0.564;
export const AM_BENIGN_BELOW = 0.34;
export const BA1_AF = 0.05;
export const BS1_AF = 0.01;
export const CADD_PATHOGENIC_MIN = 20;
export const CADD_BENIGN_BELOW = 10;

export function alphaMissenseCall(e: VariantEvidence): Call {
  const s = e.predictors.alphaMissense;
  if (e.consequence !== 'missense' || s === null) return 'no-call';
  if (s > AM_PATHOGENIC_ABOVE) return 'P/LP';
  if (s < AM_BENIGN_BELOW) return 'B/LB';
  return 'VUS';
}

export function frequencyCall(e: VariantEvidence): Call {
  const af = e.population.maxAf;
  if (af !== null && af > BS1_AF) return 'B/LB';
  return 'VUS';
}

export function caddCall(e: VariantEvidence): Call {
  const s = e.predictors.caddPhred;
  if (s === null) return 'no-call';
  if (s >= CADD_PATHOGENIC_MIN) return 'P/LP';
  if (s < CADD_BENIGN_BELOW) return 'B/LB';
  return 'VUS';
}

export function sigmaFold(e: VariantEvidence): { interpretation: Interpretation; call: Call } {
  const interpretation = interpret(e);
  return { interpretation, call: collapse(interpretation.classification) };
}
