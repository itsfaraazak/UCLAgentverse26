export { checkRunFromPipeline } from './from-pipeline';
export {
  evaluateMerge,
  introducedCommits,
  isAllowedMerge,
  recordSignoff,
} from './merge-gate';
export type {
  CheckRun,
  CheckRunStatus,
  EvaluateMergeArgs,
  MergeDecision,
} from './types';
