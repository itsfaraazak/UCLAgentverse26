import type { Sequence, Variant } from '../genome';

export type Oid = string;

export interface Blob {
  readonly kind: 'blob';
  readonly sequence: Sequence;
}

/** A genotype: gene symbol → blob oid. */
export interface Tree {
  readonly kind: 'tree';
  readonly entries: Record<string, Oid>;
}

export interface Commit {
  readonly kind: 'commit';
  readonly tree: Oid;
  readonly parents: Oid[];
  readonly author: string;
  readonly message: string;
  readonly timestamp: number;
  readonly edit?: Variant;
  readonly checkRunId?: string;
}

export type GitObject = Blob | Tree | Commit;

export interface CommitInput {
  readonly tree: Oid;
  readonly author: string;
  readonly message: string;
  readonly timestamp?: number;
  readonly parents?: readonly Oid[];
  readonly edit?: Variant;
  readonly checkRunId?: string;
}

export interface MergeConflict {
  readonly gene: string;
  readonly base: Oid | null;
  readonly ours: Oid | null;
  readonly theirs: Oid | null;
}

export type MergeResult = { readonly oid: Oid } | { readonly conflicts: MergeConflict[] };

export function isCleanMerge(result: MergeResult): result is { oid: Oid } {
  return 'oid' in result;
}
