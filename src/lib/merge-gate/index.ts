export { checkRunFromPipeline } from './from-pipeline';
export {
  evaluateMerge,
  introducedCommits,
  isAllowedMerge,
  recordSignoff,
  resolveSignoff,
  signoffRefusalReason,
} from './merge-gate';
export type { SignoffRefusal, SignoffResult } from './merge-gate';
export type {
  CheckRun,
  CheckRunStatus,
  EvaluateMergeArgs,
  MergeDecision,
} from './types';
