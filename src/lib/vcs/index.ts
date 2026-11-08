export { canonicalJson, oidOf, oidOfCanonical } from './canonical';
export { Repo } from './repo';
export type {
  Oid,
  Blob,
  Tree,
  Commit,
  GitObject,
  CommitInput,
  MergeConflict,
  MergeResult,
} from './types';
export { isCleanMerge } from './types';
