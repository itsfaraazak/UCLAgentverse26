/**
 * Serializable view types crossing the server → client boundary.
 *
 * This module imports only from the pure, framework-free `lib/genome` and
 * `lib/cellsim` modules. It deliberately does not import `lib/agents` or
 * `lib/vcs` (which reach for `node:crypto`), so client components can depend
 * on it without dragging server-only code into the browser bundle.
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
  summary: string;
  durationMs: number;
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

export interface CheckRunView {
  id: string;
  verdict: RunVerdict;
  steps: CheckStepView[];
  deltas: DeltaView[];
  metrics: SimMetrics | null;
  baselineMeanFlow: number | null;
  stressPO2: number;
  requiresSignoff: boolean;
  signoffRole: string | null;
  structuralClaim: string | null;
  verifierNotes: string[];
  screen: ScreenView;
  thresholds: { maxOcclusion: number; maxSickledFraction: number; minMeanFlowRatio: number };
}

/** The only shape a screening result may take on the client. Never any text. */
export interface ScreenView {
  category: string;
  verdict: 'allow' | 'escalate' | 'block';
  reason: string;
  requiresSignoff: boolean;
  signoffRole: string | null;
  flaggedGenes: string[];
  requestDigest: string;
  redacted: boolean;
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
}

export interface MergeAttemptView {
  ok: boolean;
  /** Branch the attempt targeted. */
  into: string;
  from: string;
  /** Present when the gate or the checks stopped the merge. */
  blockedBy: string | null;
  reason: string;
  mergeOid: string | null;
  conflicts: Array<{ gene: string; ours: string; theirs: string; base: string | null }>;
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
