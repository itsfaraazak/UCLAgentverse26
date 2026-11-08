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
