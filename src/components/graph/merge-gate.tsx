'use client';

import { useId, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Copy,
  GitMerge,
  Loader2,
  ShieldAlert,
  ShieldX,
  Split,
  XCircle,
} from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { BranchView, MergeOutcome } from '@/lib/demo/view';

/**
 * Sign-off control.
 *
 * The name is the sign-off (SPEC §7.5), so it is collected rather than
 * assumed. The server re-derives the role from the policy and refuses anything
 * that is not a name, so nothing typed here can widen what the policy allows.
 */
function SignoffControl({
  branch,
  role,
  pending,
  onSignOff,
}: {
  readonly branch: string;
  readonly role: string | null;
  readonly pending: boolean;
  readonly onSignOff: (branch: string, by: string) => void;
}) {
  const [by, setBy] = useState('');
  const inputId = useId();

  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={inputId} className="sr-only">
        Name of the person accepting this escalation
        {role === null ? '' : ` as ${role}`}
      </Label>
      <Input
        id={inputId}
        value={by}
        onChange={(event) => setBy(event.currentTarget.value)}
        placeholder={role === null ? 'Accepting reviewer' : `Accepting ${role}`}
        autoComplete="off"
        spellCheck={false}
        className="h-7 w-44 text-xs"
      />
      <Button
        variant="outline"
        size="xs"
        onClick={() => onSignOff(branch, by)}
        disabled={pending || by.trim().length < 2}
      >
        <BadgeCheck aria-hidden="true" />
        Record sign-off
      </Button>
    </div>
  );
}

export interface MergeGateProps {
  readonly into: BranchView;
  readonly from: BranchView | null;
  readonly outcome: MergeOutcome | null;
  readonly pending: boolean;
  readonly onMerge: () => void;
  readonly onSignOff: (branch: string, by: string) => void;
  readonly onDismiss: () => void;
}

export function MergeGate({
  into,
  from,
  outcome,
  pending,
  onMerge,
  onSignOff,
  onDismiss,
}: MergeGateProps) {
  const headingId = useId();
  const blockedReason = from?.mergeBlockedReason ?? null;
  const canAttempt = from !== null && !pending;

  return (
    <section
      aria-labelledby={headingId}
      className="shrink-0 border-t bg-card px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id={headingId} className="flex items-center gap-1.5 text-[13px] font-semibold">
          <GitMerge className="size-4 text-muted-foreground" aria-hidden="true" />
          Merge gate
        </h2>
        <Separator orientation="vertical" className="h-5" />

        <div className="flex min-w-0 items-center gap-2 font-mono text-[11.5px]">
          {from === null ? (
            <span className="text-muted-foreground">
              Pick a branch in the Refs rail to propose a merge into{' '}
              <span className="text-foreground">{into.name}</span>.
            </span>
          ) : (
            <>
              <span className="hairline truncate rounded-sm border px-1.5 py-0.5">{from.name}</span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="hairline truncate rounded-sm border px-1.5 py-0.5">{into.name}</span>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {from !== null && blockedReason !== null && from.status === 'escalated' && (
            <SignoffControl
              branch={from.name}
              role={null}
              pending={pending}
              onSignOff={onSignOff}
            />
          )}
          <Button size="sm" onClick={onMerge} disabled={!canAttempt}>
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <GitMerge aria-hidden="true" />
            )}
            Attempt merge
          </Button>
        </div>
      </div>

      {/* The gate's own pre-flight verdict, shown before any attempt. */}
      {from !== null && blockedReason !== null && outcome === null && (
        <GateNotice
          tone={from.status === 'escalated' ? 'escalate' : 'block'}
          title={
            from.status === 'escalated'
              ? 'This merge is held pending a human sign-off'
              : from.status === 'blocked'
                ? 'This merge is refused by the biosafety gate'
                : 'This merge is blocked by a failing check'
          }
          body={blockedReason}
        />
      )}

      {outcome !== null && <Outcome outcome={outcome} onDismiss={onDismiss} onSignOff={onSignOff} />}
    </section>
  );
}

type Tone = 'pass' | 'block' | 'escalate' | 'conflict';

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  pass: 'bg-pass-soft/60 text-pass',
  block: 'bg-block-soft/60 text-block',
  escalate: 'bg-escalate-soft/60 text-escalate',
  conflict: 'bg-conflict-soft/60 text-conflict',
};

function GateNotice({
  tone,
  title,
  body,
  children,
}: {
  readonly tone: Tone;
  readonly title: string;
  readonly body: string;
  readonly children?: React.ReactNode;
}) {
  const Icon =
    tone === 'pass'
      ? BadgeCheck
      : tone === 'conflict'
        ? Split
        : tone === 'escalate'
          ? ShieldAlert
          : ShieldX;
  return (
    <div
      role="status"
      className={`mt-3 flex items-start gap-2.5 rounded-md px-3 py-2.5 ${TONE_CLASS[tone]}`}
    >
      <Icon className="mt-px size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-foreground/80">{body}</p>
        {children}
      </div>
    </div>
  );
}

function Outcome({
  outcome,
  onDismiss,
  onSignOff,
}: {
  readonly outcome: MergeOutcome;
  readonly onDismiss: () => void;
  readonly onSignOff: (branch: string, by: string) => void;
}) {
  if (outcome.kind === 'blocked') {
    // Only a gate verdict is attributed to the policy category. A `fail` came
    // from a downstream check, and saying otherwise would misreport which part
    // of the pipeline refused the merge.
    const fromGate = outcome.verdict === 'blocked' || outcome.verdict === 'escalated';
    return (
      <GateNotice
        tone={outcome.verdict === 'escalated' ? 'escalate' : 'block'}
        title={
          outcome.verdict === 'escalated'
            ? `Merge held — ${outcome.category} requires a human sign-off`
            : outcome.verdict === 'blocked'
              ? `Merge refused — biosafety gate returned ${outcome.category}`
              : 'Merge refused — a required agent check failed'
        }
        body={outcome.reason}
      >
        <p className="mt-1.5 text-[11.5px] text-foreground/70">
          No merge commit was written and no genotype tree was combined.{' '}
          {fromGate
            ? 'The gate ran before '
            : 'The check results were re-derived on the server before '}
          <code className="font-mono">Repo.merge</code> was consulted.
        </p>
        <div className="mt-2 flex gap-2">
          {outcome.requiresSignoffBy !== null && (
            <SignoffControl
              branch={outcome.from}
              role={outcome.requiresSignoffBy}
              pending={false}
              onSignOff={onSignOff}
            />
          )}
          <Button variant="ghost" size="xs" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </GateNotice>
    );
  }

  if (outcome.kind === 'conflict') {
    return (
      <GateNotice
        tone="conflict"
        title={`Merge conflict — ${outcome.conflicts.length} gene${
          outcome.conflicts.length === 1 ? '' : 's'
        } changed differently on both sides`}
        body={
          'Both branches changed the same gene away from the merge base, so the three-way ' +
          'merge will not auto-resolve it. Nothing was committed.'
        }
      >
        <ul className="mt-2 flex flex-col divide-y divide-conflict/20 border-t border-conflict/20">
          {outcome.conflicts.map((conflict) => (
            <li
              key={conflict.gene}
              className="py-2 text-foreground"
            >
              <p className="font-mono text-[11.5px] font-semibold">{conflict.gene}</p>
              <dl className="mt-1 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                <dt className="text-muted-foreground">base</dt>
                <dd className="truncate font-mono">{conflict.baseLabel}</dd>
                <dt className="text-muted-foreground">ours</dt>
                <dd className="truncate font-mono">{conflict.oursLabel}</dd>
                <dt className="text-muted-foreground">theirs</dt>
                <dd className="truncate font-mono">{conflict.theirsLabel}</dd>
              </dl>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="xs" className="mt-2" onClick={onDismiss}>
          Dismiss
        </Button>
      </GateNotice>
    );
  }

  if (outcome.kind === 'error') {
    return (
      <GateNotice tone="block" title="Merge could not be attempted" body={outcome.reason}>
        <Button variant="ghost" size="xs" className="mt-2" onClick={onDismiss}>
          Dismiss
        </Button>
      </GateNotice>
    );
  }

  return (
    <GateNotice
      tone="pass"
      title={
        outcome.identical
          ? `Clean merge — both sides had already made the identical change`
          : `Clean merge — ${outcome.short}`
      }
      body={
        outcome.identical
          ? `${outcome.from} and ${outcome.into} resolved to the same genotype tree, so the ` +
            `three-way merge took it without a conflict. A merge commit was still written, ` +
            `recording that the two histories joined.`
          : `${outcome.from} was merged into ${outcome.into}. The gene changed on one side ` +
            `only, so the three-way merge took that side.`
      }
    >
      <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[11.5px] text-foreground/80">
        <Copy className="size-3.5" aria-hidden="true" />
        {outcome.short}
      </p>
      <Button variant="ghost" size="xs" className="mt-2" onClick={onDismiss}>
        Dismiss
      </Button>
    </GateNotice>
  );
}

export { XCircle };
