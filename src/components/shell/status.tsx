/**
 * Status presentation, in one place.
 *
 * SPEC §5 forbids colour as the only signal, so every status here renders a
 * dot, a lucide icon and a text label together. Keeping the mapping in a
 * single module is what stops the rail, the run log and the merge view from
 * drifting into three different vocabularies for the same verdict.
 */

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  MinusCircle,
  ShieldX,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { AgentStepView, CheckRunView } from './model/types';

export type StatusTone =
  | 'passed'
  | 'escalated'
  | 'failed'
  | 'blocked'
  | 'pending'
  | 'not-run';

interface ToneSpec {
  readonly icon: LucideIcon;
  readonly label: string;
}

const TONES: Readonly<Record<StatusTone, ToneSpec>> = Object.freeze({
  passed: { icon: CheckCircle2, label: 'Passed' },
  escalated: { icon: AlertTriangle, label: 'Escalated' },
  failed: { icon: XCircle, label: 'Failed' },
  blocked: { icon: ShieldX, label: 'Blocked' },
  pending: { icon: CircleDashed, label: 'No run' },
  'not-run': { icon: MinusCircle, label: 'Not run' },
});

export function toneForCheck(check: CheckRunView): StatusTone {
  switch (check.status) {
    case 'passed':
      return check.requiresSignoff && check.signedOffBy === null
        ? 'escalated'
        : 'passed';
    case 'escalated':
      return 'escalated';
    case 'failed':
      return 'failed';
    case 'pending':
      return 'pending';
  }
}

export function toneForStep(step: AgentStepView): StatusTone {
  switch (step.outcome) {
    case 'passed':
      return 'passed';
    case 'escalated':
      return 'escalated';
    case 'blocked':
      return 'blocked';
    case 'not-run':
      return 'not-run';
  }
}

export function statusLabel(tone: StatusTone): string {
  return TONES[tone].label;
}

/**
 * A dot plus an icon plus a label. `labelled={false}` hides the text
 * visually but keeps it for assistive technology, for the places where the
 * row is too dense for a word — the icon still carries the meaning sighted
 * readers need, so colour is never alone even then.
 */
export function StatusMark({
  tone,
  label,
  labelled = true,
  showDot = true,
}: {
  readonly tone: StatusTone;
  readonly label?: string;
  readonly labelled?: boolean;
  readonly showDot?: boolean;
}) {
  const spec = TONES[tone];
  const Icon = spec.icon;
  const text = label ?? spec.label;
  return (
    <span className={`status status--${tone}`}>
      {showDot ? <span className="status__dot" aria-hidden="true" /> : null}
      <Icon className="status__icon" strokeWidth={1.75} aria-hidden="true" />
      {labelled ? <span>{text}</span> : <span className="sr-only">{text}</span>}
    </span>
  );
}

/** The same vocabulary as a filled pill, for summary positions. */
export function StatusPill({
  tone,
  label,
}: {
  readonly tone: StatusTone;
  readonly label?: string;
}) {
  const spec = TONES[tone];
  const Icon = spec.icon;
  return (
    <span className={`pill status--${tone}`}>
      <Icon className="pill__icon" strokeWidth={2} aria-hidden="true" />
      {label ?? spec.label}
    </span>
  );
}
