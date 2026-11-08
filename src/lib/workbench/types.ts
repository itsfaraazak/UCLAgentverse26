import type { AcmgClassification, AcmgCode } from '../acmg/types';
import type { PolicyCategory, Verdict } from '../safety/policy';
import type {
  Interpretation,
  LiteratureResult,
  ReferenceComparison,
  SourceRef,
  VariantEvidence,
} from '../evidence/types';

/**
 * The workbench: a shared, append-only version history where humans and
 * agents work on the same case. Every prompt, tool result, comment, sign-off
 * and merge is one attributed delta. Nothing is edited in place — a
 * disagreement forks the record instead of overwriting it.
 *
 * This file is the contract between the server (`lib/workbench`, the API
 * routes) and the client (`components/workbench`). It must stay free of
 * Node-only imports so the client can import its types.
 */

export type Actor =
  | { readonly kind: 'human'; readonly name: string; readonly role: string | null }
  /** `model: null` means a deterministic component, not a language model. */
  | { readonly kind: 'agent'; readonly name: string; readonly model: string | null };

export type WbDeltaKind =
  | 'prompt'
  | 'gate'
  | 'plan'
  | 'evidence'
  | 'interpretation'
  | 'reference'
  | 'literature'
  | 'edit'
  | 'message'
  | 'comment'
  | 'assertion'
  | 'signoff'
  | 'merge'
  | 'error';

export type RequestMode = 'interpret' | 'edit';

export interface ToolTrace {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly ms: number;
}

/**
 * `VARIANT_INTERPRETATION` is the workbench's own category for reading an
 * observed variant: it proposes no edit, so it is in scope for any gene. The
 * edit categories come unchanged from `lib/safety/policy`.
 */
export type GateCategory = PolicyCategory | 'VARIANT_INTERPRETATION';

export interface GateData {
  readonly mode: RequestMode;
  readonly verdict: Verdict;
  readonly category: GateCategory;
  readonly reason: string;
  readonly requiresSignoff: boolean;
  readonly signoffRole: string | null;
  readonly flaggedGenes: readonly string[];
  /** When true the UI must not echo the request text (policy redaction). */
  readonly redacted: boolean;
  readonly requestDigest: string;
}

export interface EditData {
  readonly gene: string;
  /** The variant being corrected, as resolved evidence names it. */
  readonly variantId: string;
  readonly description: string;
  /** Codon and amino-acid view of the correction (alt -> ref). */
  readonly codon: { readonly position: number | null; readonly from: string | null; readonly to: string | null };
  readonly aminoAcid: { readonly from: string | null; readonly to: string | null };
  readonly gate: GateData;
}

export type AssertionData =
  | { readonly kind: 'dismiss'; readonly code: AcmgCode; readonly reason: string }
  | { readonly kind: 'segregation'; readonly value: boolean; readonly reason: string };

export interface SignoffData {
  readonly finalClassification: AcmgClassification;
  readonly agentClassification: AcmgClassification | null;
  readonly agreesWithAgent: boolean;
  readonly rationale: string;
  /** Id of the interpretation delta this sign-off covers. */
  readonly covers: string | null;
}

export interface DeltaDataMap {
  readonly prompt: { readonly text: string };
  readonly gate: GateData;
  readonly plan: { readonly steps: readonly string[] };
  readonly evidence: { readonly evidence: VariantEvidence; readonly tool: ToolTrace | null };
  readonly interpretation: { readonly interpretation: Interpretation; readonly evidenceDelta: string };
  readonly reference: { readonly comparison: ReferenceComparison; readonly interpretationDelta: string };
  readonly literature: { readonly result: LiteratureResult; readonly tool: ToolTrace | null };
  readonly edit: EditData;
  readonly message: { readonly markdown: string };
  readonly comment: { readonly text: string; readonly onDelta: string | null };
  readonly assertion: AssertionData;
  readonly signoff: SignoffData;
  readonly merge: { readonly branch: string; readonly branchHead: string };
  readonly error: { readonly message: string; readonly recoverable: boolean };
}

export interface WbDelta<K extends WbDeltaKind = WbDeltaKind> {
  /** sha256 of the canonical content, 16 hex chars. */
  readonly id: string;
  /** Monotonic across the workspace; the display order. */
  readonly seq: number;
  readonly branch: string;
  readonly kind: K;
  readonly actor: Actor;
  /** One line, shown as the card heading. */
  readonly title: string;
  /** Short plain-text summary under the heading. May be empty. */
  readonly body: string;
  readonly data: DeltaDataMap[K];
  readonly parents: readonly string[];
  /** ISO timestamp. */
  readonly at: string;
  readonly sources: readonly SourceRef[];
}

export type AnyDelta = { [K in WbDeltaKind]: WbDelta<K> }[WbDeltaKind];

export type BranchStatus = 'open' | 'running' | 'blocked' | 'merged';

export interface WbBranch {
  readonly name: string;
  readonly title: string;
  /** Where this branch forked from. `null` only for `main`. */
  readonly parent: { readonly branch: string; readonly delta: string | null } | null;
  readonly createdBy: Actor;
  readonly createdAt: string;
  readonly status: BranchStatus;
  /** Latest delta on this branch, or null when empty. */
  readonly head: string | null;
}

export type MergeCheckId = 'gate' | 'classification' | 'reference' | 'signoff' | 'idle';
export type MergeCheckState = 'pass' | 'fail' | 'pending' | 'n/a';

export interface MergeCheck {
  readonly id: MergeCheckId;
  readonly label: string;
  readonly state: MergeCheckState;
  readonly detail: string;
}

export interface MergeStatus {
  readonly allowed: boolean;
  readonly checks: readonly MergeCheck[];
  /** Role the sign-off must come from when policy names one, else null. */
  readonly requiredRole: string | null;
}

export interface AiStatus {
  readonly available: boolean;
  readonly model: string;
  readonly reason: string;
}

export interface WorkspaceSnapshot {
  readonly id: string;
  readonly title: string;
  readonly branches: readonly WbBranch[];
  /** Every delta in the workspace, ordered by `seq`. */
  readonly deltas: readonly AnyDelta[];
  readonly merge: Readonly<Record<string, MergeStatus>>;
  readonly ai: AiStatus;
}

export const MAIN_BRANCH = 'main';

export const SIGNOFF_ROLES = [
  'Clinical scientist',
  'Genetic counsellor',
  'Consultant clinical geneticist',
  'Principal investigator',
  'Institutional biosafety committee',
] as const;
