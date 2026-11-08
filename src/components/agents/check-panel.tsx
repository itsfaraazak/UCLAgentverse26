'use client';

/**
 * The seven-agent CI run, as an indicator panel rather than a log: a lamp per
 * agent, a tabular duration, and the attributed delta behind each lamp.
 */

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  BadgeCheck,
  CircleSlash,
  FlaskConical,
  GitMerge,
  Loader2,
  Microscope,
  Play,
  Radar,
  ScanSearch,
  ShieldAlert,
  Signature,
  Target,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from 'cn';
import type { CheckRunView, MergeAttemptView, StepStatus } from '@/app/bench-types';

export interface CheckPanelProps {
  run: CheckRunView | null;
  pending: boolean;
  onRun: () => void;
  onMerge: () => void;
  merge: MergeAttemptView | null;
  mergePending: boolean;
  signedOff: boolean;
  onSignOff: () => void;
  frameLabel: string;
  branch: string;
}

const AGENT_ICONS: Readonly<Record<string, ComponentType<{ className?: string }>>> = {
  IntentAgent: ScanSearch,
  BiosafetyGateAgent: ShieldAlert,
  EditPlannerAgent: Target,
  StructuralImpactAgent: Microscope,
  FunctionalAssayAgent: FlaskConical,
  OffTargetRiskAgent: Radar,
  VerifierAgent: BadgeCheck,
};

const LAMP: Readonly<Record<StepStatus, string>> = {
  pass: 'bg-signal-ok shadow-[0_0_8px_var(--signal-ok)]',
  fail: 'bg-signal-alarm shadow-[0_0_8px_var(--signal-alarm)]',
  blocked: 'bg-signal-alarm shadow-[0_0_10px_var(--signal-alarm)]',
  escalated: 'bg-signal-warn shadow-[0_0_8px_var(--signal-warn)]',
  skipped: 'bg-muted-foreground/35',
};

const STATUS_WORD: Readonly<Record<StepStatus, string>> = {
  pass: 'PASS',
  fail: 'FAIL',
  blocked: 'BLOCKED',
  escalated: 'ESCALATED',
  skipped: 'NOT RUN',
};

const AGENT_ORDER: readonly string[] = [
  'IntentAgent',
  'BiosafetyGateAgent',
  'EditPlannerAgent',
  'StructuralImpactAgent',
  'FunctionalAssayAgent',
  'OffTargetRiskAgent',
  'VerifierAgent',
];

export function CheckPanel({
  run,
  pending,
  onRun,
  onMerge,
  merge,
  mergePending,
  signedOff,
  onSignOff,
  frameLabel,
  branch,
}: CheckPanelProps) {
  const verdictTone =
    run === null
      ? 'text-muted-foreground'
      : run.verdict === 'pass'
        ? 'text-signal-ok'
        : run.verdict === 'escalated'
          ? 'text-signal-warn'
          : 'text-signal-alarm';

  return (
    <section aria-labelledby="checks-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="checks-heading"
          className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
        >
          <ShieldAlert className="size-3.5" aria-hidden="true" />
          Agent check run
        </h2>
        <Button type="button" size="sm" onClick={onRun} disabled={pending}>
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="size-3.5" aria-hidden="true" />
          )}
          {pending ? 'Running' : run === null ? 'Run checks' : 'Re-run'}
        </Button>
      </div>

      <div className="bezel-surface rounded-lg border border-bezel-edge/70 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {frameLabel} · <span className="font-mono">{branch}</span>
          </span>
          <span className={cn('tnum font-mono text-sm font-semibold', verdictTone)}>
            {run === null ? 'NOT RUN' : run.verdict.toUpperCase()}
            {run !== null ? (
              <span className="ml-2 text-[0.625rem] font-normal text-muted-foreground">
                {run.id} · {run.elapsedMs.toFixed(1)} ms · pO2 {run.requestedPO2}
              </span>
            ) : null}
          </span>
        </div>

        <Separator className="my-3" />

        <ol className="space-y-0.5">
          {AGENT_ORDER.map((agent, i) => {
            const step = run?.steps.find((s) => s.agent === agent) ?? null;
            const Icon = AGENT_ICONS[agent] ?? ScanSearch;
            const status: StepStatus = step?.status ?? 'skipped';
            return (
              <li key={agent} className="flex items-center gap-2.5 py-1">
                <span
                  aria-hidden="true"
                  className={cn('size-2 shrink-0 rounded-full', LAMP[status])}
                />
                <span className="tnum w-4 shrink-0 font-mono text-[0.625rem] text-muted-foreground">
                  {i + 1}
                </span>
                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-xs">{agent}</span>
                <span className="tnum shrink-0 font-mono text-[0.625rem] text-muted-foreground">
                  {step?.deltaId ?? '—'}
                </span>
                <span
                  className={cn(
                    'tnum w-[5.5rem] shrink-0 text-right font-mono text-[0.625rem] font-semibold',
                    status === 'pass'
                      ? 'text-signal-ok'
                      : status === 'escalated'
                        ? 'text-signal-warn'
                        : status === 'skipped'
                          ? 'text-muted-foreground'
                          : 'text-signal-alarm',
                  )}
                >
                  {STATUS_WORD[status]}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {run !== null ? (
        <>
          <div className="rounded-lg border border-border bg-card p-3">
            <h3 className="text-[0.625rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Gate
            </h3>
            <p className="tnum mt-1 font-mono text-xs">
              {run.screen.category} → {run.screen.verdict.toUpperCase()}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{run.screen.reason}</p>
            <p className="tnum mt-1 font-mono text-[0.625rem] text-muted-foreground">
              digest {run.screen.requestDigest}
              {run.screen.flaggedGenes.length > 0
                ? ` · flagged ${run.screen.flaggedGenes.join(', ')}`
                : ''}
            </p>
          </div>

          <Accordion className="rounded-lg border border-border bg-card">
            <AccordionItem value="deltas">
              <AccordionTrigger className="px-3 text-xs">
                Delta trail · {run.deltas.length} attributed entries
              </AccordionTrigger>
              <AccordionContent className="px-3">
                <ol className="space-y-2">
                  {run.deltas.map((d) => (
                    <li key={d.id} className="rounded-md border border-border/70 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="tnum font-mono">
                          {d.id}
                        </Badge>
                        <Badge variant="secondary">{d.kind}</Badge>
                        <span className="text-[0.625rem] text-muted-foreground">
                          {d.author} · {d.subject}
                        </span>
                      </div>
                      {d.parents.length > 0 ? (
                        <p className="tnum mt-1 font-mono text-[0.625rem] text-muted-foreground">
                          parents {d.parents.join(', ')}
                        </p>
                      ) : null}
                      <pre className="tnum mt-1.5 max-h-44 overflow-auto rounded-sm bg-muted/60 p-2 font-mono text-[0.625rem] leading-relaxed whitespace-pre-wrap">
                        {d.payload}
                      </pre>
                    </li>
                  ))}
                </ol>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="rounded-lg border border-border bg-card p-3">
            <h3 className="flex items-center gap-1.5 text-[0.625rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              <BadgeCheck className="size-3" aria-hidden="true" />
              Verifier cross-check
            </h3>
            {run.verifierDisagreedWithAssay || run.verifierDisagreedWithStructural ? (
              <p className="mt-1.5 text-xs text-signal-warn">
                The verifier disagreed with
                {run.verifierDisagreedWithAssay ? ' the functional assay' : ''}
                {run.verifierDisagreedWithAssay && run.verifierDisagreedWithStructural
                  ? ' and'
                  : ''}
                {run.verifierDisagreedWithStructural ? ' the structural annotation' : ''}. It
                re-ran the simulation itself rather than taking their word for it.
              </p>
            ) : null}
            {run.verifierReasons.length > 0 ? (
              <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                {run.verifierReasons.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Measured metrics agree with the upstream agents.
              </p>
            )}
            {run.measuredLowPO2 !== null && run.measuredReferenceLowPO2 !== null ? (
              <dl className="tnum mt-2 grid grid-cols-3 gap-x-3 gap-y-1 font-mono text-[0.625rem]">
                <dt className="col-span-3 font-sans text-muted-foreground">
                  Independent hypoxic run vs reference allele
                </dt>
                <dd>occl {run.measuredLowPO2.occlusion.toFixed(3)}</dd>
                <dd>flow {run.measuredLowPO2.meanFlow.toFixed(2)}</dd>
                <dd>sickled {run.measuredLowPO2.sickledFraction.toFixed(3)}</dd>
                <dd className="text-muted-foreground">
                  ref {run.measuredReferenceLowPO2.occlusion.toFixed(3)}
                </dd>
                <dd className="text-muted-foreground">
                  ref {run.measuredReferenceLowPO2.meanFlow.toFixed(2)}
                </dd>
                <dd className="text-muted-foreground">
                  ref {run.measuredReferenceLowPO2.sickledFraction.toFixed(3)}
                </dd>
              </dl>
            ) : null}
            {run.assayLimitation !== null ? (
              <p className="mt-2 text-[0.625rem] text-muted-foreground italic">
                {run.assayLimitation}
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          No run on this frame yet. The gate is agent 2 and a block ends the run before any
          downstream agent executes.
        </p>
      )}

      <div className="recess-surface space-y-2 rounded-lg border border-bezel-edge/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-[0.625rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            <GitMerge className="size-3" aria-hidden="true" />
            Merge gate
          </h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onMerge}
            disabled={mergePending || branch === 'main'}
          >
            {mergePending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <GitMerge className="size-3.5" aria-hidden="true" />
            )}
            Merge into main
          </Button>
        </div>

        {run !== null && run.requiresSignoff ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-signal-warn/40 bg-signal-warn/10 p-2">
            <span className="text-xs">
              Escalated. Named human sign-off required
              {run.signoffRole !== null ? `: ${run.signoffRole}` : ''}.
            </span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={onSignOff}
              disabled={signedOff}
            >
              <Signature className="size-3" aria-hidden="true" />
              {signedOff ? 'Sign-off recorded' : 'Record sign-off'}
            </Button>
          </div>
        ) : null}

        {merge !== null ? (
          <div
            className={cn(
              'rounded-md border p-2 text-xs',
              merge.ok
                ? 'border-signal-ok/40 bg-signal-ok/10'
                : 'border-signal-alarm/40 bg-signal-alarm/10',
            )}
          >
            <p className="flex items-center gap-1.5 font-semibold">
              {merge.ok ? (
                <BadgeCheck className="size-3.5" aria-hidden="true" />
              ) : (
                <CircleSlash className="size-3.5" aria-hidden="true" />
              )}
              {merge.ok ? 'Merged' : 'Merge stopped'}
              {merge.kind !== null ? (
                <span className="tnum font-mono text-[0.625rem] font-normal">{merge.kind}</span>
              ) : null}
            </p>
            <p className="mt-1 text-muted-foreground">{merge.reason}</p>
            {merge.blockingReasons.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-[0.6875rem] text-muted-foreground">
                {merge.blockingReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
            {merge.conflicts.length > 0 ? (
              <ul className="tnum mt-1 space-y-0.5 font-mono text-[0.625rem]">
                {merge.conflicts.map((c) => (
                  <li key={c.gene}>
                    {c.gene}: ours {c.ours ?? 'absent'} vs theirs {c.theirs ?? 'absent'}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            A merge runs the checks first. Nothing merges on a failing or escalated run.
          </p>
        )}
      </div>
    </section>
  );
}
