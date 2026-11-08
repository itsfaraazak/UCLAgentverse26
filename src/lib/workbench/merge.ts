import type {
  AnyDelta,
  BranchStatus,
  GateData,
  MergeCheck,
  MergeStatus,
  WbDelta,
  WbDeltaKind,
} from './types';

/**
 * Merge checks over a branch's ancestry. Pure: the same history always gives
 * the same verdict, so a reviewer can re-derive why a merge was refused.
 */

export function ofKind<K extends WbDeltaKind>(deltas: readonly AnyDelta[], kind: K): WbDelta<K>[] {
  return deltas.filter((d) => d.kind === kind) as unknown as WbDelta<K>[];
}

export function latestOfKind<K extends WbDeltaKind>(
  deltas: readonly AnyDelta[],
  kind: K,
): WbDelta<K> | null {
  const all = ofKind(deltas, kind);
  return all.length > 0 ? all[all.length - 1] : null;
}

/** Every gate verdict on the history: request gates and edit-proposal gates. */
export function gateVerdicts(deltas: readonly AnyDelta[]): { delta: AnyDelta; gate: GateData }[] {
  const out: { delta: AnyDelta; gate: GateData }[] = [];
  for (const d of deltas) {
    if (d.kind === 'gate') out.push({ delta: d, gate: d.data });
    else if (d.kind === 'edit') out.push({ delta: d, gate: d.data.gate });
  }
  return out;
}

export function requiredRoleFor(deltas: readonly AnyDelta[]): string | null {
  let role: string | null = null;
  for (const { gate } of gateVerdicts(deltas)) {
    if (gate.requiresSignoff && gate.signoffRole !== null) role = gate.signoffRole;
  }
  return role;
}

export function isBlocked(deltas: readonly AnyDelta[]): boolean {
  return gateVerdicts(deltas).some((g) => g.gate.verdict === 'block');
}

export function latestInterpretation(deltas: readonly AnyDelta[]): WbDelta<'interpretation'> | null {
  return latestOfKind(deltas, 'interpretation');
}

/** The reference check run against `interpretation`, if any. */
export function referenceFor(
  deltas: readonly AnyDelta[],
  interpretation: WbDelta<'interpretation'>,
): WbDelta<'reference'> | null {
  const refs = ofKind(deltas, 'reference').filter((r) => r.data.interpretationDelta === interpretation.id);
  return refs.length > 0 ? refs[refs.length - 1] : null;
}

/** Sign-offs made after `interpretation`; older ones are stale. */
export function currentSignoffs(
  deltas: readonly AnyDelta[],
  interpretation: WbDelta<'interpretation'>,
): WbDelta<'signoff'>[] {
  return ofKind(deltas, 'signoff').filter((s) => s.seq > interpretation.seq);
}

function signerOf(s: WbDelta<'signoff'>): { name: string; role: string | null } {
  return s.actor.kind === 'human' ? { name: s.actor.name, role: s.actor.role } : { name: s.actor.name, role: null };
}

function short(id: string): string {
  return id.slice(0, 8);
}

function gateCheck(deltas: readonly AnyDelta[]): MergeCheck {
  const label = 'Safety gate';
  const verdicts = gateVerdicts(deltas);
  const blocked = verdicts.find((v) => v.gate.verdict === 'block');
  if (blocked !== undefined) {
    return {
      id: 'gate',
      label,
      state: 'fail',
      detail: `Blocked by policy (${blocked.gate.category}) at [${short(blocked.delta.id)}].`,
    };
  }
  if (verdicts.length === 0) {
    return { id: 'gate', label, state: 'n/a', detail: 'No request has been screened on this branch yet.' };
  }
  const escalated = verdicts.find((v) => v.gate.verdict === 'escalate');
  if (escalated !== undefined) {
    return {
      id: 'gate',
      label,
      state: 'pass',
      detail: `Escalated (${escalated.gate.category}): sign-off required from ${escalated.gate.signoffRole ?? 'a named human'}.`,
    };
  }
  return { id: 'gate', label, state: 'pass', detail: `${verdicts.length} screened, none blocked.` };
}

function classificationCheck(interp: WbDelta<'interpretation'> | null): MergeCheck {
  const label = 'ACMG classification';
  if (interp === null) {
    return { id: 'classification', label, state: 'pending', detail: 'Awaiting the ACMG classifier.' };
  }
  const i = interp.data.interpretation;
  return {
    id: 'classification',
    label,
    state: 'pass',
    detail: `${i.classification} (${i.points} points) at [${short(interp.id)}].`,
  };
}

function referenceCheck(deltas: readonly AnyDelta[], interp: WbDelta<'interpretation'> | null): MergeCheck {
  const label = 'ClinVar reference';
  if (interp === null) {
    return { id: 'reference', label, state: 'pending', detail: 'Runs after classification.' };
  }
  const ref = referenceFor(deltas, interp);
  if (ref === null) {
    return { id: 'reference', label, state: 'pending', detail: 'Awaiting the ClinVar comparison for the latest classification.' };
  }
  const c = ref.data.comparison;
  if (c.severity === 'unavailable') {
    return { id: 'reference', label, state: 'pass', detail: `ClinVar has no usable consensus: ${c.note}` };
  }
  if (c.severity === 'major') {
    const ack = currentSignoffs(deltas, interp).find((s) => s.data.covers === interp.id);
    if (ack === undefined) {
      return {
        id: 'reference',
        label,
        state: 'pending',
        detail: `Major disagreement with ClinVar (${c.clinvar.consensus ?? 'no consensus'}); a human must sign off acknowledging it.`,
      };
    }
    return { id: 'reference', label, state: 'pass', detail: `Disagreement acknowledged by ${signerOf(ack).name}.` };
  }
  return {
    id: 'reference',
    label,
    state: 'pass',
    detail: c.severity === 'minor' ? `Minor difference from ClinVar: ${c.note}` : `Agrees with ClinVar (${c.clinvar.consensus ?? 'n/a'}).`,
  };
}

function signoffCheck(
  deltas: readonly AnyDelta[],
  interp: WbDelta<'interpretation'> | null,
  requiredRole: string | null,
): MergeCheck {
  const label = 'Human sign-off';
  const who = requiredRole ?? 'a named human';
  if (interp === null) {
    return { id: 'signoff', label, state: 'pending', detail: `Needs a classification, then sign-off from ${who}.` };
  }
  const current = currentSignoffs(deltas, interp);
  const valid = current.filter((s) => requiredRole === null || signerOf(s).role === requiredRole);
  if (valid.length > 0) {
    const s = valid[valid.length - 1];
    const signer = signerOf(s);
    return {
      id: 'signoff',
      label,
      state: 'pass',
      detail: `Signed off by ${signer.name}${signer.role ? ` (${signer.role})` : ''}: ${s.data.finalClassification}.`,
    };
  }
  if (current.length > 0) {
    return {
      id: 'signoff',
      label,
      state: 'pending',
      detail: `Sign-off by ${signerOf(current[current.length - 1]).name} does not count: policy requires ${who}.`,
    };
  }
  const stale = ofKind(deltas, 'signoff');
  if (stale.length > 0) {
    return {
      id: 'signoff',
      label,
      state: 'pending',
      detail: `Sign-off by ${signerOf(stale[stale.length - 1]).name} is stale: newer classification [${short(interp.id)}] needs review.`,
    };
  }
  return { id: 'signoff', label, state: 'pending', detail: `Awaiting sign-off from ${who}.` };
}

function idleCheck(status: BranchStatus): MergeCheck {
  const label = 'No agent running';
  if (status === 'running') return { id: 'idle', label, state: 'fail', detail: 'An agent run is in progress.' };
  if (status === 'merged') return { id: 'idle', label, state: 'fail', detail: 'Already merged into main.' };
  return { id: 'idle', label, state: 'pass', detail: 'Idle.' };
}

export function computeMergeStatus(deltas: readonly AnyDelta[], status: BranchStatus): MergeStatus {
  const interp = latestInterpretation(deltas);
  const requiredRole = requiredRoleFor(deltas);
  const checks: MergeCheck[] = [
    gateCheck(deltas),
    classificationCheck(interp),
    referenceCheck(deltas, interp),
    signoffCheck(deltas, interp, requiredRole),
    idleCheck(status),
  ];
  return {
    allowed: checks.every((c) => c.state === 'pass' || c.state === 'n/a'),
    checks,
    requiredRole,
  };
}

/** One line per check that stops a merge. */
export function refusalReasons(status: MergeStatus): string[] {
  return status.checks
    .filter((c) => c.state !== 'pass' && c.state !== 'n/a')
    .map((c) => `${c.label}: ${c.detail}`);
}
