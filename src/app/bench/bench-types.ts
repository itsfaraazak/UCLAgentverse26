/**
 * Serializable view types crossing the server → client boundary.
 *
 * This module imports only from the pure, framework-free `lib/genome` and
 * `lib/cellsim` modules. It deliberately does not import `lib/agents`,
 * `lib/vcs` or `lib/safety` (which reach for `node:crypto`), so client
 * components can depend on it without dragging server-only code into the
 * browser bundle.
 */

import type { DiffRow } from '@/lib/genome';
import type { SimMetrics } from '@/lib/cellsim';

export type StepStatus = 'pass' | 'fail' | 'blocked' | 'escalated' | 'skipped';
export type RunVerdict = 'pass' | 'fail' | 'blocked' | 'escalated';

export interface CheckStepView {
  index: number;
  agent: string;
  kind: string;
  status: StepStatus;
  /** Generic. Never templated with refused request text. */
  summary: string;
  deltaId: string | null;
}

export interface DeltaView {
  id: string;
  kind: string;
  author: string;
  subject: string;
  parents: string[];
  createdAt: number;
  /** Pretty-printed payload. Never contains refused request text. */
  payload: string;
}

/** The only shape a screening result may take on the client. Never any text. */
export interface ScreenView {
  category: string;
  verdict: 'allow' | 'escalate' | 'block';
  reason: string;
  requiresSignoff: boolean;
  signoffRole: string | null;
  /** Curated gene symbols only, and empty whenever `redacted` is true. */
  flaggedGenes: string[];
  requestDigest: string;
  redacted: boolean;
}

export interface CheckRunView {
  id: string;
  verdict: RunVerdict;
  steps: CheckStepView[];
  deltas: DeltaView[];
  screen: ScreenView;
  /** Wall-clock cost of the whole deterministic run, measured server-side. */
  elapsedMs: number;
  requestedPO2: number;
  requiresSignoff: boolean;
  signoffRole: string | null;
  mergeAllowed: boolean;
  verifierReasons: string[];
  verifierDisagreedWithAssay: boolean;
  verifierDisagreedWithStructural: boolean;
  /** The verifier's own independent runs, not the assay agent's numbers. */
  measuredHighPO2: SimMetrics | null;
  measuredLowPO2: SimMetrics | null;
  measuredReferenceLowPO2: SimMetrics | null;
  /** The functional assay agent's run at the requested oxygen tension. */
  assayMetrics: SimMetrics | null;
  assayAssessment: string | null;
  assayLimitation: string | null;
  structuralLimitation: string | null;
}

export interface ExonView {
  index: number;
  label: string;
  codonStart: number;
  codonEnd: number;
  modelled: boolean;
  note: string;
}

export interface StructuralView {
  refAa: string;
  altAa: string;
  refAaName: string;
  altAaName: string;
  summary: string;
  consequence: string;
  polymerizationTendency: number;
  confidence: string;
  limitation: string;
}

export interface FrameView {
  id: string;
  /** 'reference' | 'mutant' | 'repaired' — the filmstrip ordering. */
  role: string;
  label: string;
  branch: string;
  commitOid: string;
  shortOid: string;
  commitMessage: string;
  parentShortOids: string[];
  genotypeId: string;
  provenance: string;
  polymerizationTendency: number;
  bases: string;
  protein: string;
  diff: DiffRow[];
  /** Diff against the preceding filmstrip frame, not the reference. */
  diffFromPrevious: DiffRow[];
  previousLabel: string | null;
  changedCodonIndex: number | null;
  variantLabel: string | null;
  hgvs: string | null;
  proteinHgvs: string | null;
  legacyName: string | null;
  numberingNote: string | null;
  structural: StructuralView | null;
}

export interface LocusView {
  gene: string;
  name: string;
  chromosome: string;
  provenance: string;
  note: string;
  referenceLabel: string;
  codonCount: number;
  exons: ExonView[];
}

export interface SimFixtureView {
  seed: number;
  cellCount: number;
  pO2Default: number;
  capillaryConstriction: number;
  pO2Min: number;
  pO2Max: number;
  pO2Unit: string;
  pO2Label: string;
  sicklingOnsetBelow: number;
  assaySteps: number;
  modelLimitation: string;
  /**
   * Mean flow for a genotype with no polymerization tendency, measured by
   * `runAssay` over `assaySteps` at the fixture's default pO₂.
   *
   * Every "% of reference" reading on the bench is against this one figure.
   * It is **not** the verifier's denominator: `verifyEdit` measures wildtype
   * at `PO2_RANGE.min`, because a hypoxic challenge is what distinguishes the
   * genotypes. So the gauge and the verifier can legitimately differ — the
   * gauge answers "how does this genotype flow at the pO₂ on the slider",
   * the verifier answers "does it still occlude under hypoxia". Reading one
   * as a prediction of the other is the mistake this comment exists to
   * prevent; an earlier version of it claimed they could not disagree.
   */
  referenceMeanFlow: number;
}

export interface MergeAttemptView {
  ok: boolean;
  into: string;
  from: string;
  /** 'content-conflict' | 'check-failed' | 'awaiting-signoff' | 'check-missing' */
  kind: string | null;
  reason: string;
  mergeOid: string | null;
  conflicts: Array<{ gene: string; ours: string | null; theirs: string | null; base: string | null }>;
  blockingReasons: string[];
  requiresSignoff: boolean;
  signoffRole: string | null;
}

export interface BenchData {
  locus: LocusView;
  frames: FrameView[];
  branches: string[];
  simulation: SimFixtureView;
  disclaimer: string;
}
