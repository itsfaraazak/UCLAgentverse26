import type { AcmgClassification, AcmgCode, AcmgInputs, AcmgResult } from '../acmg/types';

/**
 * Where a fact came from. Every evidence value shown in the UI carries one, so
 * a reviewer can open the source and check the number themselves.
 */
export interface SourceRef {
  readonly name: string;
  readonly url: string;
  readonly licence: string;
  readonly licenceUrl: string | null;
  /** ISO timestamp of the fetch, or of the cache snapshot when served from cache. */
  readonly retrievedAt: string;
  /** True when the value was served from the on-disk/shipped cache, not live. */
  readonly cached: boolean;
}

export interface ResolvedVariant {
  /** MyVariant.info `_id`: GRCh38 genomic HGVS, e.g. `chr11:g.5227002T>A`. */
  readonly id: string;
  readonly assembly: 'GRCh38';
  readonly rsid: string | null;
  readonly gene: string | null;
  /** e.g. `NM_000518.5:c.20A>T`, when a source names one. */
  readonly hgvsCoding: string | null;
  /** e.g. `NP_000509.1:p.Glu7Val`, when a source names one. */
  readonly hgvsProtein: string | null;
  /** The text the user typed. */
  readonly query: string;
  /** Other candidate ids the query matched (e.g. other alleles at an rsID). */
  readonly alternates: readonly string[];
}

export type Consequence =
  | 'missense'
  | 'synonymous'
  | 'stop_gained'
  | 'frameshift'
  | 'splice'
  | 'inframe_indel'
  | 'start_lost'
  | 'other'
  | 'unknown';

export interface ProteinChange {
  readonly refAa: string | null;
  readonly altAa: string | null;
  readonly position: number | null;
  readonly refCodon: string | null;
  readonly altCodon: string | null;
}

export type AlphaMissenseClass = 'likely_benign' | 'ambiguous' | 'likely_pathogenic';

/**
 * Evidence the classifier is allowed to see. ClinVar is deliberately absent:
 * it is the answer key, held out in `ClinvarRecord` and revealed only after a
 * classification exists.
 */
export interface VariantEvidence {
  readonly variant: ResolvedVariant;
  readonly consequence: Consequence;
  readonly consequenceRaw: readonly string[];
  readonly protein: ProteinChange | null;
  readonly population: {
    readonly gnomadGenomeAf: number | null;
    readonly gnomadExomeAf: number | null;
    /** Max of the two; null when the variant is absent from both. */
    readonly maxAf: number | null;
  };
  readonly predictors: {
    /** Max AlphaMissense score across transcripts, in [0, 1]. */
    readonly alphaMissense: number | null;
    /** Cheng et al. 2023 thresholds: < 0.34 benign, > 0.564 pathogenic. */
    readonly alphaMissenseClass: AlphaMissenseClass | null;
    readonly caddPhred: number | null;
  };
  readonly sources: readonly SourceRef[];
}

export type ClinvarConsensus = AcmgClassification | 'Conflicting' | 'Other';

export interface ClinvarRecord {
  readonly found: boolean;
  readonly consensus: ClinvarConsensus | null;
  /** Raw `clinical_significance` strings across submissions. */
  readonly significances: readonly string[];
  readonly reviewStatus: string | null;
  /** ClinVar review stars, 0-4. */
  readonly stars: 0 | 1 | 2 | 3 | 4;
  readonly url: string | null;
  readonly source: SourceRef;
}

export interface EvidenceBundle {
  readonly evidence: VariantEvidence;
  readonly clinvar: ClinvarRecord;
}

export interface Paper {
  readonly pmid: string | null;
  readonly title: string;
  readonly journal: string | null;
  readonly year: number | null;
  readonly url: string;
}

export interface LiteratureResult {
  readonly query: string;
  readonly papers: readonly Paper[];
  readonly source: SourceRef;
}

/**
 * Human-only adjustments. Agents can suggest these in prose, but only a
 * human-attributed request can apply them.
 */
export interface CriterionDismissal {
  readonly code: AcmgCode;
  readonly reason: string;
  readonly by: string;
}

export interface HumanAssertions {
  readonly segregation: { readonly value: boolean; readonly reason: string; readonly by: string } | null;
  readonly dismissed: readonly CriterionDismissal[];
}

export const NO_ASSERTIONS: HumanAssertions = Object.freeze({ segregation: null, dismissed: [] });

export interface Interpretation {
  readonly inputs: AcmgInputs;
  /** Plain-English note per input saying where its value came from. */
  readonly inputNotes: Readonly<Record<keyof AcmgInputs, string>>;
  /** The engine's own result, before any human dismissal. */
  readonly engine: AcmgResult;
  /** Final points/classification after human dismissals; equals `engine` when none. */
  readonly points: number;
  readonly classification: AcmgClassification;
  readonly dismissed: readonly CriterionDismissal[];
  readonly limitation: string;
  readonly citation: string;
}

export type ReferenceSeverity = 'none' | 'minor' | 'major' | 'unavailable';

export interface ReferenceComparison {
  readonly clinvar: ClinvarRecord;
  readonly agentClassification: AcmgClassification;
  /** null when ClinVar has no usable consensus. */
  readonly agrees: boolean | null;
  /**
   * `major` when the two sides fall on opposite sides of the actionable line
   * (P/LP vs anything else) or point in opposite directions (P/LP vs B/LB).
   */
  readonly severity: ReferenceSeverity;
  readonly note: string;
}

export class VariantNotFoundError extends Error {
  constructor(readonly query: string) {
    super(`No variant matched "${query}". Try an rsID (rs334) or gene + HGVS (BRCA1 c.5266dupC).`);
    this.name = 'VariantNotFoundError';
  }
}

export class EvidenceSourceError extends Error {
  constructor(
    readonly sourceName: string,
    message: string,
  ) {
    super(message);
    this.name = 'EvidenceSourceError';
  }
}

/**
 * The evidence layer's public surface. The workbench agent depends on this
 * interface, not on the implementation, so it can be tested with a fake.
 */
export interface EvidenceService {
  resolveVariant(query: string): Promise<ResolvedVariant>;
  fetchEvidence(variant: ResolvedVariant): Promise<EvidenceBundle>;
  interpret(evidence: VariantEvidence, assertions?: HumanAssertions): Interpretation;
  compareWithReference(interpretation: Interpretation, clinvar: ClinvarRecord): ReferenceComparison;
  searchLiterature(query: string, limit?: number): Promise<LiteratureResult>;
}
