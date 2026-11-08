import { isScreenPayload, isVerdictPayload } from '../agents/types';
import type { PipelineResult } from '../agents/types';
import type { Oid } from '../vcs';
import type { CheckRun, CheckRunStatus } from './types';

function latestOfKind(
  result: PipelineResult,
  kind: 'screen' | 'verdict',
): { payload: unknown } | undefined {
  const all = result.dag.all();
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const delta = all[i];
    if (delta !== undefined && delta.kind === kind) return delta;
  }
  return undefined;
}

function reasonsFromPipeline(result: PipelineResult): readonly string[] {
  const reasons: string[] = [];
  const screenDelta = latestOfKind(result, 'screen');
  // Only when the screen itself blocked or escalated. A run can now be
  // escalated by a downstream agent while the screen verdict is `allow`, and
  // prepending the screen's reassuring allow-reason would make a held check
  // read as approved.
  if (
    screenDelta !== undefined &&
    isScreenPayload(screenDelta.payload) &&
    (result.blocked || result.escalated) &&
    screenDelta.payload.verdict !== 'allow'
  ) {
    reasons.push(screenDelta.payload.reason);
  }
  const verdictDelta = latestOfKind(result, 'verdict');
  if (verdictDelta !== undefined && isVerdictPayload(verdictDelta.payload)) {
    for (const reason of verdictDelta.payload.reasons) {
      reasons.push(reason);
    }
  }
  if (reasons.length === 0) {
    if (result.blocked) reasons.push('Biosafety gate blocked this edit.');
    else if (!result.passed) reasons.push('Pipeline did not pass.');
  }
  return reasons;
}

function statusFromPipeline(result: PipelineResult): CheckRunStatus {
  if (result.blocked) return 'failed';
  if (result.escalated) return 'escalated';
  if (result.passed) return 'passed';
  return 'failed';
}

/**
 * Map a pipeline run onto a `CheckRun`. `signedOffBy` is never inferred —
 * an escalation stays unsigned until a caller records a human actor.
 */
export function checkRunFromPipeline(args: {
  readonly commit: Oid;
  readonly result: PipelineResult;
  readonly id?: string;
  readonly signedOffBy?: string;
}): CheckRun {
  const signedOffBy =
    args.signedOffBy !== undefined && args.signedOffBy.trim().length > 0
      ? args.signedOffBy.trim()
      : undefined;
  return {
    id: args.id ?? args.result.headId,
    commit: args.commit,
    status: statusFromPipeline(args.result),
    // Carried so a refusal can be worded as a refusal and a verifier failure
    // as a verifier failure. Both remain unsignable.
    blockedAtGate: args.result.blocked,
    requiresSignoff: args.result.requiresSignoff,
    ...(args.result.signoffRole !== undefined ? { signoffRole: args.result.signoffRole } : {}),
    ...(signedOffBy !== undefined ? { signedOffBy } : {}),
    reasons: reasonsFromPipeline(args.result),
  };
}
