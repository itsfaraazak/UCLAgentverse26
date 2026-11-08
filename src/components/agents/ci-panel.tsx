'use client';

/**
 * The right pane: a CI run on a pull request.
 *
 * The seven agents of SPEC §4.3 as a run list, each row expandable to its
 * delta detail, plus the merge gate at the bottom.
 *
 * Safety-relevant rendering rules honoured here:
 *   * when the gate blocks, rows 3–7 render as "not executed" — the UI shows
 *     the pipeline stopping, it does not show results with a warning beside them;
 *   * an escalation renders its required sign-off as an explicit action, and
 *     the merge stays held until a name is entered;
 *   * nothing drawn from the request text is displayed, because the server
 *     never sends any. Only the category, the generic policy reason, the
 *     allow-listed gene symbols and the one-way digest cross the boundary.
 */

import {
  Activity,
  ChevronRight,
  FileCheck2,
  FlaskConical,
  GitMerge,
  Hash,
  Info,
  ListTree,
  Loader2,
  Microscope,
  PenLine,
  PlayCircle,
  Radar,
  ShieldCheck,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';

import type { MergeDecisionView } from '@/app/ide/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CHECK_STATUS_STYLE, VERDICT_HEADLINE } from '@/components/shell/status-ide';
import type { DeltaView, RunView, StepDetail, StepView } from '@/lib/run-view';
// The pipeline's shape only. Importing a value from `@/lib/agents` here would
// bundle lib/safety, and with it node:crypto, into the browser.
import { PIPELINE_STEPS, agentRole } from '@/lib/run-view/steps';

const AGENT_ICON: Readonly<Record<string, LucideIcon>> = {
  IntentAgent: ListTree,
  BiosafetyGateAgent: ShieldCheck,
  EditPlannerAgent: Target,
  StructuralImpactAgent: Microscope,
  FunctionalAssayAgent: FlaskConical,
  OffTargetRiskAgent: Radar,
  VerifierAgent: FileCheck2,
};

export interface RecordedSignOff {
  readonly approver: string;
  readonly role: string;
}

export interface CiPanelProps {
  readonly run: RunView | null;
  readonly merge: MergeDecisionView | null;
  readonly mergeTarget: string | null;
  readonly branch: string;
  readonly busy: boolean;
  readonly signOffError: string | null;
  readonly recordedSignOff: RecordedSignOff | null;
  readonly onRun: () => void;
  readonly onSignOff: (approver: string) => void;
  readonly onAttemptMerge: () => void;
}

function CheckRowView({
  step,
  deltas,
}: {
  readonly step: StepView;
  readonly deltas: readonly DeltaView[];
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const style = CHECK_STATUS_STYLE[step.status];
  const StatusIcon = style.icon;
  const AgentIcon = AGENT_ICON[step.agent] ?? ListTree;
  const delta = step.deltaId === null ? undefined : deltas.find((d: DeltaView) => d.id === step.deltaId);

  return (
    <li className="border-b border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v: boolean) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-muted/50"
      >
        <ChevronRight
          className={`mt-px size-3.5 shrink-0 text-muted-foreground transition-transform ${
            open ? 'rotate-90' : ''
          }`}
          aria-hidden
        />
        <span className="nums mt-px w-3 shrink-0 text-[11px] text-muted-foreground">
          {step.step}
        </span>
        <StatusIcon className={`mt-px size-3.5 shrink-0 ${style.fg}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <AgentIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-mono text-[12px] font-medium">{step.agent}</span>
            <span
              className={`ml-auto shrink-0 rounded-sm px-1 text-[9.5px] font-medium tracking-wide uppercase ${style.chip}`}
            >
              {style.label}
            </span>
          </span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
            {step.summary}
          </span>
        </span>
      </button>

      {open && (
        <div id={panelId} className="bg-card px-2.5 py-2">
          <p className="mb-1.5 text-[11px] leading-snug text-muted-foreground">{agentRole(step.agent)}</p>
          <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1 text-[11px]">
            {step.details.map((d: StepDetail) => (
              <div key={d.label} className="col-span-2 grid grid-cols-subgrid">
                <dt className="text-muted-foreground">{d.label}</dt>
                <dd className="nums leading-snug break-words">{d.value}</dd>
              </div>
            ))}
          </dl>

          {step.limitation !== null && (
            <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-snug text-muted-foreground">
              <Info className="size-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold">Limits of this check: </span>
                {step.limitation}
              </span>
            </p>
          )}

          {delta !== undefined && (
            <p className="nums mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Hash className="size-3" aria-hidden />
                {delta.id}
              </span>
              <span>kind {delta.kind}</span>
              <span>author {delta.author}</span>
              <span>subject {delta.subject}</span>
              <span>parents {delta.parents.length === 0 ? '—' : delta.parents.join(', ')}</span>
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The merge outcome as icon + label + reason, so the decision never rests on
 * the box's tint alone.
 */
function MergeOutcome({ merge }: { readonly merge: MergeDecisionView }) {
  const style = merge.allowed
    ? CHECK_STATUS_STYLE.passed
    : merge.kind === 'awaiting-signoff'
      ? CHECK_STATUS_STYLE.escalated
      : merge.kind === 'content-conflict'
        ? CHECK_STATUS_STYLE.warning
        : CHECK_STATUS_STYLE.failed;
  const Icon = style.icon;
  const label = merge.allowed
    ? null
    : merge.kind === 'awaiting-signoff'
      ? 'Merge held'
      : merge.kind === 'content-conflict'
        ? 'Merge conflict'
        : 'Merge refused';
  return (
    <p className="flex items-start gap-1.5">
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        {label !== null && <span className="font-semibold">{label}. </span>}
        {merge.allowed ? 'Merge allowed.' : merge.reasons.join(' ')}
      </span>
    </p>
  );
}

function mergeTone(merge: MergeDecisionView): string {
  if (merge.allowed) {
    return 'bg-status-pass/10 text-status-pass';
  }
  if (merge.kind === 'awaiting-signoff') {
    return 'bg-status-escalated/10 text-status-escalated';
  }
  if (merge.kind === 'content-conflict') {
    return 'bg-verdict-conflict-soft text-verdict-conflict';
  }
  return 'bg-status-fail/10 text-status-fail';
}

export function CiPanel({
  run,
  merge,
  mergeTarget,
  branch,
  busy,
  signOffError,
  recordedSignOff,
  onRun,
  onSignOff,
  onAttemptMerge,
}: CiPanelProps) {
  const [approver, setApprover] = useState('');
  const approverId = useId();

  const conclusionStyle =
    run === null
      ? null
      : run.conclusion === 'blocked'
        ? CHECK_STATUS_STYLE.blocked
        : run.conclusion === 'escalated'
          ? CHECK_STATUS_STYLE.escalated
          : run.conclusion === 'failed'
            ? CHECK_STATUS_STYLE.failed
            : CHECK_STATUS_STYLE.passed;
  const ConclusionIcon = conclusionStyle?.icon;
  const awaitingSignOff =
    run !== null &&
    recordedSignOff === null &&
    run.requiresSignoff &&
    merge !== null &&
    merge.kind === 'awaiting-signoff';

  return (
    <section aria-label="Agent CI panel" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-chrome-border bg-chrome px-2.5 py-1.5">
        <Activity className="size-3.5 text-muted-foreground" aria-hidden />
        <h2 className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Checks
        </h2>
        <Button
          size="xs"
          variant={run === null ? 'default' : 'outline'}
          onClick={onRun}
          disabled={busy}
          className="ml-auto"
        >
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <PlayCircle aria-hidden />
          )}
          {run === null ? 'Run checks' : 'Re-run'}
        </Button>
      </div>

      {run === null ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            No run yet for <span className="font-mono text-foreground">{branch}</span>.
          </p>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            Running the pipeline screens this branch&apos;s request through the biosafety gate at
            step 2, then — only if the gate allows it — resolves the edit, annotates the structural
            consequence, runs the simulation headless, checks the sensitive-locus registry, and
            cross-checks every claim against the measured numbers.
          </p>
          <ol className="mt-1 space-y-1">
            {PIPELINE_STEPS.map(({ agent }, i) => {
              const Icon = AGENT_ICON[agent] ?? ListTree;
              return (
                <li key={agent} className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                  <span className="nums w-3 text-[10px]">{i + 1}</span>
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    <span className="font-mono">{agent}</span>
                    <span className="mt-0.5 block text-[10.5px] leading-snug">
                      {agentRole(agent)}
                    </span>
                  </span>
                  {i === 1 && (
                    <span className="rounded-sm bg-status-blocked/10 px-1 text-[9.5px] font-medium tracking-wide text-status-blocked uppercase">
                      gate
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {conclusionStyle !== null && ConclusionIcon !== undefined && (
            <div className="shrink-0 border-b border-border px-2.5 py-2">
              <p className="flex items-center gap-1.5">
                <ConclusionIcon className={`size-4 shrink-0 ${conclusionStyle.fg}`} aria-hidden />
                <span className={`text-[12.5px] font-semibold ${conclusionStyle.fg}`}>
                  {run.conclusion === 'blocked'
                    ? 'Run terminated at the biosafety gate'
                    : run.conclusion === 'escalated'
                      ? 'Escalated — awaiting named human sign-off'
                      : run.conclusion === 'failed'
                        ? 'Checks failed'
                        : 'All seven checks passed'}
                </span>
              </p>
              <p className="nums mt-1 font-mono text-[10px] text-muted-foreground">
                {run.id} · {branch} · {run.agentsRun}/7 agents · {run.deltas.length} deltas · gate{' '}
                {run.screen.category}
              </p>
            </div>
          )}

          <div
            className={`shrink-0 border-b border-border px-2.5 py-2 ${
              run.screen.verdict === 'block'
                ? 'bg-status-blocked/8'
                : run.screen.verdict === 'escalate'
                  ? 'bg-status-escalated/8'
                  : ''
            }`}
          >
            <p className="flex items-center gap-1.5 text-[11px] font-semibold">
              <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {VERDICT_HEADLINE[run.screen.verdict]}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{run.screen.reason}</p>
            {run.screen.redacted && (
              <p className="mt-1.5 text-[10.5px] leading-snug text-status-blocked">
                The request text was not retained and is not displayed. Only the category{' '}
                <span className="font-mono">{run.screen.category}</span>, this reason, and the digest{' '}
                <span className="font-mono">{run.screen.requestDigest}</span> are on the record.
              </p>
            )}
          </div>

          <ul className="shrink-0">
            {run.steps.map((step: StepView) => (
              <CheckRowView key={step.agent} step={step} deltas={run.deltas} />
            ))}
          </ul>

          {awaitingSignOff && (
            <form
              className="shrink-0 border-b border-border bg-status-escalated/8 px-2.5 py-2"
              onSubmit={(e: FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                if (approver.trim() !== '') onSignOff(approver.trim());
              }}
            >
              <label
                htmlFor={approverId}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-status-escalated"
              >
                <PenLine className="size-3.5 shrink-0" aria-hidden />
                Sign-off required from{' '}
                {run.signoffRole ??
                  (merge !== null ? merge.signoffRole : null) ??
                  'a human reviewer'}
              </label>
              <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
                Nothing auto-approves an escalation. Enter the name of the person accepting
                responsibility for this run. The role that satisfies the gate is derived on the
                server from the policy verdict; it is not chosen here.
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <Input
                  id={approverId}
                  value={approver}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setApprover(e.currentTarget.value)
                  }
                  placeholder="name of approver"
                  className="h-7 font-mono text-[11px]"
                  autoComplete="off"
                />
                <Button type="submit" size="xs" disabled={busy || approver.trim() === ''}>
                  Record
                </Button>
              </div>
              {signOffError !== null && (
                <p className="mt-1.5 text-[10.5px] leading-snug text-status-fail" role="alert">
                  {signOffError}
                </p>
              )}
            </form>
          )}

          {recordedSignOff !== null && (
            <p className="shrink-0 border-b border-border bg-status-pass/8 px-2.5 py-2 text-[11px] text-status-pass">
              <PenLine className="mr-1 inline size-3.5 align-[-3px]" aria-hidden />
              Signed off by <span className="font-mono">{recordedSignOff.approver}</span> as{' '}
              <span className="font-mono">{recordedSignOff.role}</span>.
            </p>
          )}

          <div className="mt-auto shrink-0 border-t border-chrome-border bg-chrome px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <GitMerge className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <h3 className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                Merge gate
              </h3>
              <Button
                size="xs"
                variant="outline"
                className="ml-auto"
                onClick={onAttemptMerge}
                disabled={busy || mergeTarget === null}
              >
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <GitMerge aria-hidden />}
                Attempt merge
              </Button>
            </div>
            <p className="mt-1 nums font-mono text-[10px] text-muted-foreground">
              {branch} → {mergeTarget ?? merge?.target ?? '(no base branch)'}
            </p>
            {merge !== null && (
              <div className={`mt-1.5 rounded-md px-2 py-1.5 text-[11px] leading-snug ${mergeTone(merge)}`}>
                <MergeOutcome merge={merge} />
                {merge.conflicts.length > 0 && (
                  <p className="mt-0.5 font-mono text-[10px]">
                    conflicts: {merge.conflicts.join(', ')}
                  </p>
                )}
              </div>
            )}
            {merge !== null && merge.mergedOid !== null && (
              <p className="mt-1.5 nums font-mono text-[10.5px] leading-snug">
                merged {merge.mergedOid}
                {merge.target !== null ? ` → ${merge.target}` : ''}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
