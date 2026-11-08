import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleSlash,
  ShieldAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import type { CheckStatus } from '@/lib/agents';
import type { Verdict } from '@/lib/safety/policy';

export interface StatusStyle {
  readonly icon: LucideIcon;
  readonly label: string;
  /** Tailwind classes bound to the status tokens in globals.css. */
  readonly fg: string;
  readonly chip: string;
}

export const CHECK_STATUS_STYLE: Readonly<Record<CheckStatus, StatusStyle>> = {
  pass: {
    icon: CheckCircle2,
    label: 'pass',
    fg: 'text-status-pass',
    chip: 'bg-status-pass/12 text-status-pass border-status-pass/30',
  },
  warn: {
    icon: AlertTriangle,
    label: 'warn',
    fg: 'text-status-warn',
    chip: 'bg-status-warn/12 text-status-warn border-status-warn/30',
  },
  fail: {
    icon: XCircle,
    label: 'fail',
    fg: 'text-status-fail',
    chip: 'bg-status-fail/12 text-status-fail border-status-fail/30',
  },
  blocked: {
    icon: Ban,
    label: 'blocked',
    fg: 'text-status-blocked',
    chip: 'bg-status-blocked/14 text-status-blocked border-status-blocked/40',
  },
  escalated: {
    icon: ShieldAlert,
    label: 'escalated',
    fg: 'text-status-escalated',
    chip: 'bg-status-escalated/12 text-status-escalated border-status-escalated/30',
  },
  skipped: {
    icon: CircleSlash,
    label: 'not run',
    fg: 'text-status-skipped',
    chip: 'bg-status-skipped/12 text-status-skipped border-status-skipped/30',
  },
};

export const VERDICT_STYLE: Readonly<Record<Verdict, StatusStyle>> = {
  allow: CHECK_STATUS_STYLE.pass,
  escalate: CHECK_STATUS_STYLE.escalated,
  block: CHECK_STATUS_STYLE.blocked,
};

/** Human-facing label for a policy verdict, stated as the gate's own action. */
export const VERDICT_HEADLINE: Readonly<Record<Verdict, string>> = {
  allow: 'Allowed by policy',
  escalate: 'Escalated — held for named human review',
  block: 'Blocked by policy',
};
