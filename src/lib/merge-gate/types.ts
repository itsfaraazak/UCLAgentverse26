import type { MergeConflict, Oid, Repo } from '../vcs';

export type CheckRunStatus = 'passed' | 'failed' | 'escalated' | 'pending';

/**
 * A completed or in-flight check for one commit. `signedOffBy` is recorded
 * only by an explicit human action — never by the pipeline.
 */
export interface CheckRun {
  readonly id: string;
  readonly commit: Oid;
  readonly status: CheckRunStatus;
  readonly requiresSignoff: boolean;
  readonly signoffRole?: string;
  readonly signedOffBy?: string;
  readonly reasons: readonly string[];
  /**
   * True only when the biosafety gate refused this edit. A verifier failure
   * is also `status: 'failed'`, so without this the two are indistinguishable
   * and the UI announced a verifier failure as a gate refusal — the one place
   * the app stated something false about the safety boundary.
   *
   * It narrows wording only. `resolveSignoff` refuses a `failed` check either
   * way, so an absent or false value cannot make anything signable.
   */
  readonly blockedAtGate?: boolean;
}

export type MergeDecision =
  | { readonly allowed: true; readonly oid: Oid }
  | {
      readonly allowed: false;
      readonly kind: 'content-conflict';
      readonly conflicts: readonly MergeConflict[];
    }
  | {
      readonly allowed: false;
      readonly kind: 'check-failed';
      readonly blocking: readonly CheckRun[];
      readonly reasons: readonly string[];
    }
  | {
      readonly allowed: false;
      readonly kind: 'awaiting-signoff';
      readonly blocking: readonly CheckRun[];
      readonly signoffRole: string;
    }
  | {
      readonly allowed: false;
      readonly kind: 'check-missing';
      readonly commits: readonly Oid[];
    };

export interface EvaluateMergeArgs {
  readonly repo: Repo;
  readonly ours: Oid;
  readonly theirs: Oid;
  readonly checks: ReadonlyMap<string, CheckRun>;
}
