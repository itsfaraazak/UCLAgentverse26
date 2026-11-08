import type { PolicyCategory, Verdict } from '@/lib/safety/policy';
import type { SimMetrics, SimParams } from '@/lib/cellsim';

export type DeltaKind =
  | 'intent'
  | 'screen'
  | 'edit_plan'
  | 'structural'
  | 'assay'
  | 'offtarget'
  | 'verdict'
  | 'signoff';

export interface Delta {
  readonly id: string;
  readonly kind: DeltaKind;
  readonly author: string;
  readonly subject: string;
  readonly payload: unknown;
  readonly parents: readonly string[];
  readonly createdAt: number;
}

export type DeltaInput = Omit<Delta, 'id'> & { readonly id?: string };

export type RequestedOperation =
  | 'repair'
  | 'introduce'
  | 'disrupt'
  | 'silent'
  | 'unresolved';

export interface IntentPayload {
  readonly targets: readonly string[];
  readonly operation: RequestedOperation;
  readonly variantHint: string | null;
}

export interface ScreenPayload {
  readonly category: PolicyCategory;
  readonly verdict: Verdict;
  readonly reason: string;
  readonly requiresSignoff: boolean;
  readonly signoffRole?: string;
  readonly flaggedGenes: readonly string[];
  readonly requestDigest: string;
  readonly redacted: boolean;
}

export interface EditPlanPayload {
  readonly resolved: boolean;
  readonly gene: string | null;
  readonly variantId: string | null;
  readonly variantLabel: string | null;
  readonly genotypeId: string | null;
  readonly genotypeLabel: string | null;
  readonly codonIndex: number | null;
  readonly refCodon: string | null;
  readonly altCodon: string | null;
  readonly kind: string | null;
  readonly polymerizationTendency: number | null;
  readonly note: string;
}

export interface StructuralPayload {
  readonly sourcedFromFixture: boolean;
  readonly variantId: string | null;
  readonly refAa: string | null;
  readonly altAa: string | null;
  readonly refAaName: string | null;
  readonly altAaName: string | null;
  readonly summary: string;
  readonly consequence: string;
  readonly polymerizationTendency: number | null;
  readonly confidence: string | null;
  readonly limitation: string;
}

export type AssayAssessment = 'flow_preserved' | 'flow_impaired' | 'unresolved';

export interface AssayPayload {
  readonly ran: boolean;
  readonly params: SimParams | null;
  readonly metrics: SimMetrics | null;
  readonly assessment: AssayAssessment;
  readonly limitation: string;
}

export interface OffTargetPayload {
  readonly method: 'curated-registry-lookup';
  readonly targets: readonly string[];
  readonly hits: readonly {
    readonly gene: string;
    readonly classification: string;
    readonly note: string;
  }[];
}

export interface VerdictPayload {
  readonly passed: boolean;
  readonly mergeBlocked: boolean;
  readonly requiresSignoff: boolean;
  readonly signoffRole?: string;
  readonly reasons: readonly string[];
  readonly disagreedWithAssay: boolean;
  readonly disagreedWithStructural: boolean;
  readonly measured: {
    readonly highPO2: SimMetrics | null;
    readonly lowPO2: SimMetrics | null;
    readonly referenceLowPO2: SimMetrics | null;
  };
}

export interface PipelineInput {
  readonly text: string;
  readonly pO2?: number;
  readonly seed?: number;
  readonly assaySteps?: number;
}

export interface PipelineResult {
  readonly dag: DeltaDAGView;
  readonly blocked: boolean;
  readonly escalated: boolean;
  readonly passed: boolean;
  readonly mergeAllowed: boolean;
  readonly requiresSignoff: boolean;
  readonly signoffRole?: string;
  readonly headId: string;
}

export interface DeltaDAGView {
  add(d: DeltaInput): Delta;
  get(id: string): Delta;
  all(): Delta[];
  history(id: string): Delta[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isIntentPayload(value: unknown): value is IntentPayload {
  if (!isRecord(value) || !Array.isArray(value.targets)) return false;
  return typeof value.operation === 'string';
}

export function isScreenPayload(value: unknown): value is ScreenPayload {
  if (!isRecord(value)) return false;
  return (
    typeof value.category === 'string' &&
    typeof value.verdict === 'string' &&
    typeof value.reason === 'string' &&
    typeof value.requestDigest === 'string' &&
    typeof value.redacted === 'boolean'
  );
}

export function isEditPlanPayload(value: unknown): value is EditPlanPayload {
  return isRecord(value) && typeof value.resolved === 'boolean';
}

export function isStructuralPayload(value: unknown): value is StructuralPayload {
  return isRecord(value) && typeof value.sourcedFromFixture === 'boolean';
}

export function isAssayPayload(value: unknown): value is AssayPayload {
  return isRecord(value) && typeof value.ran === 'boolean';
}

export function isOffTargetPayload(value: unknown): value is OffTargetPayload {
  return isRecord(value) && value.method === 'curated-registry-lookup';
}

export function isVerdictPayload(value: unknown): value is VerdictPayload {
  return isRecord(value) && typeof value.passed === 'boolean' && Array.isArray(value.reasons);
}
