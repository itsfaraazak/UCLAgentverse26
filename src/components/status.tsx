import {
  CheckCircle2,
  CircleDot,
  CircleSlash,
  GitMerge,
  MinusCircle,
  ShieldAlert,
  ShieldX,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { CheckStatusView, NodeStatus } from '@/lib/demo/view';

export interface StatusLook {
  readonly label: string;
  readonly Icon: LucideIcon;
  /** CSS colour for the graph node ring and the verdict text. */
  readonly color: string;
  /** Tailwind classes for a badge/pill. */
  readonly pill: string;
  /** Short word used in the graph's text alternative. */
  readonly short: string;
}

/** The six verdict states a commit node can carry. */
export const NODE_STATUS: Readonly<Record<NodeStatus, StatusLook>> = {
  pass: {
    label: 'All checks passed',
    short: 'passed',
    Icon: CheckCircle2,
    color: 'var(--verdict-pass)',
    pill: 'bg-pass-soft text-pass',
  },
  fail: {
    label: 'A check failed',
    short: 'failed',
    Icon: XCircle,
    color: 'var(--verdict-block)',
    pill: 'bg-block-soft text-block',
  },
  escalated: {
    label: 'Escalated — needs human sign-off',
    short: 'escalated',
    Icon: ShieldAlert,
    color: 'var(--verdict-escalate)',
    pill: 'bg-escalate-soft text-escalate',
  },
  blocked: {
    label: 'Refused at the biosafety gate',
    short: 'blocked',
    Icon: ShieldX,
    color: 'var(--verdict-block)',
    pill: 'bg-block-soft text-block',
  },
  none: {
    label: 'No checks — nothing was proposed',
    short: 'unchecked',
    Icon: CircleDot,
    color: 'var(--verdict-neutral)',
    pill: 'bg-neutral-verdict-soft text-muted-foreground',
  },
};

export const CHECK_STATUS: Readonly<Record<CheckStatusView, StatusLook>> = {
  ...NODE_STATUS,
  skipped: {
    label: 'Skipped — the run ended before this step',
    short: 'skipped',
    Icon: MinusCircle,
    color: 'var(--verdict-neutral)',
    pill: 'bg-neutral-verdict-soft text-muted-foreground',
  },
};

/**
 * The badge a commit node carries.
 *
 * A merge or root commit proposes no edit, so there is nothing for the
 * pipeline to check. Labelling those "unchecked" would read as *checks were
 * skipped*, which is a different and misleading claim — they are labelled for
 * what they are instead.
 */
export function nodeBadge(commit: {
  readonly status: NodeStatus;
  readonly isMerge: boolean;
  readonly isRoot: boolean;
}): StatusLook {
  const base = NODE_STATUS[commit.status];
  if (commit.status !== 'none') return base;
  if (commit.isMerge) {
    return { ...base, short: 'merge', label: 'Merge commit — it introduces no edit of its own', Icon: GitMerge };
  }
  if (commit.isRoot) {
    return {
      ...base,
      short: 'import',
      label: 'Root commit — the reference allele was imported, not edited',
      Icon: CircleDot,
    };
  }
  return base;
}

export const MERGE_LOOK = {
  merge: { label: 'Merge commit', Icon: GitMerge },
  conflict: {
    label: 'Merge conflict',
    Icon: CircleSlash,
    color: 'var(--verdict-conflict)',
    pill: 'bg-conflict-soft text-conflict',
  },
} as const;

/** Six-step lane palette, matching the CSS custom properties. */
export function laneColor(lane: number): string {
  return `var(--graph-lane-${(lane % 6) + 1})`;
}
