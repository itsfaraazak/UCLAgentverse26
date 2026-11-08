'use client';

/**
 * The right pane: a CI run on a pull request.
 *
 * The seven agents of SPEC §4.3 as a run list, each row expandable to its
 * delta detail, plus the merge gate at the bottom.
 *
 * Safety-relevant rendering rules honoured here:
 *   * when the gate blocks, rows 3–7 render as "not run" — the UI shows the
 *     pipeline stopping, it does not show results with a warning beside them;
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
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CHECK_STATUS_STYLE, VERDICT_HEADLINE } from '@/components/shell/status';
import type { AgentId, CheckRun, Delta, MergeDecision, PipelineRun } from '@/lib/agents';

const AGENT_ICON: Readonly<Record<AgentId, LucideIcon>> = {
  IntentAgent: ListTree,
  BiosafetyGateAgent: ShieldCheck,
  EditPlannerAgent: Target,
  StructuralImpactAgent: Microscope,
  FunctionalAssayAgent: FlaskConical,
  OffTargetRiskAgent: Radar,
  VerifierAgent: FileCheck2,
};

export interface CiPanelProps {
  readonly run: PipelineRun | null;
  readonly merge: MergeDecision | null;
  readonly mergeVcs: string | null;
  readonly mergeTarget: string | null;
  readonly branch: string;
  readonly busy: boolean;
  readonly onRun: () => void;
  readonly onSignOff: (approver: string) => void;
  readonly onAttemptMerge: () => void;
}

function CheckRowView({ check, deltas }: { readonly check: CheckRun; readonly deltas: readonly Delta[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const style = CHECK_STATUS_STYLE[check.status];
  const StatusIcon = style.icon;
  const AgentIcon = AGENT_ICON[check.agent];
  const delta = check.deltaId === null ? undefined : deltas.find((d) => d.id === check.deltaId);

  return (
    <li className="border-b border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-muted/50"
      >
        <ChevronRight
          className={`mt-[3px] size-3 shrink-0 text-muted-foreground transition-transform ${
            open ? 'rotate-90' : ''
          }`}
          aria-hidden
        />
        <span className="nums mt-[1px] w-3 shrink-0 font-mono text-[11px] text-muted-foreground">
          {check.step}
        </span>
        <StatusIcon className={`mt-[2px] size-3.5 shrink-0 ${style.fg}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <AgentIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-mono text-[12px] font-medium">{check.agent}</span>
            <span
              className={`ml-auto shrink-0 rounded-sm border px-1 font-mono text-[9.5px] tracking-wide uppercase ${style.chip}`}
            >
              {style.label}
            </span>
            {check.durationMs > 0 && (
              <span className="nums shrink-0 font-mono text-[10px] text-muted-foreground">
                {check.durationMs < 1 ? '<1' : Math.round(check.durationMs)}ms
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
            {check.summary}
          </span>
        </span>
      </button>

      {open && (
        <div id={panelId} className="border-t border-border/40 bg-card/50 px-2.5 py-2">
          <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1 text-[11px]">
            {check.details.map((d) => (
              <div key={d.label} className="col-span-2 grid grid-cols-subgrid">
                <dt className="font-mono text-muted-foreground">{d.label}</dt>
                <dd className="nums leading-snug break-words">{d.value}</dd>
              </div>
            ))}
          </dl>

          {check.limitation !== undefined && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-[10.5px] leading-snug text-muted-foreground">
              <Info className="mt-[1px] size-3 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold">Limits of this check: </span>
                {check.limitation}
              </span>
            </p>
          )}

          {delta !== undefined && (
            <p className="nums mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Hash className="size-2.5" aria-hidden />
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

export function CiPanel({
  run,
  merge,
  mergeVcs,
  mergeTarget,
  branch,
  busy,
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
            ? CHECK_STATUS_STYLE.fail
            : CHECK_STATUS_STYLE.pass;
  const ConclusionIcon = conclusionStyle?.icon;

  return (
    <section aria-label="Agent CI panel" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-chrome-border bg-chrome/95 px-2.5 py-1.5">
        <Activity className="size-3 text-muted-foreground" aria-hidden />
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
            {(
              [
                'IntentAgent',
                'BiosafetyGateAgent',
                'EditPlannerAgent',
                'StructuralImpactAgent',
                'FunctionalAssayAgent',
                'OffTargetRiskAgent',
                'VerifierAgent',
              ] as const
            ).map((agent, i) => {
              const Icon = AGENT_ICON[agent];
              return (
                <li key={agent} className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                  <span className="nums w-3 font-mono text-[10px]">{i + 1}</span>
                  <Icon className="size-3 shrink-0" aria-hidden />
                  <span className="font-mono">{agent}</span>
                  {i === 1 && (
                    <span className="rounded-sm border border-status-blocked/40 bg-status-blocked/10 px-1 font-mono text-[9px] tracking-wide text-status-blocked uppercase">
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
          {/* Run conclusion. */}
          {conclusionStyle !== null && ConclusionIcon !== undefined && (
            <div className={`shrink-0 border-b border-border px-2.5 py-2`}>
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
                {run.id} · {run.branch} · {run.deltas.length} deltas · gate {run.gate.category}
              </p>
            </div>
          )}

          {/* Gate verdict, rendered as the gate's own action. */}
          <div
            className={`shrink-0 border-b border-border px-2.5 py-2 ${
              run.gate.verdict === 'block'
                ? 'bg-status-blocked/8'
                : run.gate.verdict === 'escalate'
                  ? 'bg-status-escalated/8'
                  : ''
            }`}
          >
            <p className="flex items-center gap-1.5 text-[11px] font-semibold">
              <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {VERDICT_HEADLINE[run.gate.verdict]}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{run.gate.reason}</p>
            {run.gate.redacted && (
              <p className="mt-1.5 rounded-md border border-status-blocked/30 bg-status-blocked/10 px-2 py-1 text-[10.5px] leading-snug text-status-blocked">
                The request text was not retained and is not displayed. Only the category{' '}
                <span className="font-mono">{run.gate.category}</span>, this reason, and the digest{' '}
                <span className="font-mono">{run.gate.requestDigest}</span> are on the record.
              </p>
            )}
          </div>

          <ul className="shrink-0">
            {run.checks.map((check) => (
              <CheckRowView key={check.agent} check={check} deltas={run.deltas} />
            ))}
          </ul>

          {/* Escalation sign-off. Never automatic (SPEC §7.5). */}
          {run.requiresSignoff && run.signoff === null && run.conclusion !== 'blocked' && (
            <form
              className="shrink-0 border-b border-border bg-status-escalated/8 px-2.5 py-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (approver.trim() !== '') onSignOff(approver.trim());
              }}
            >
              <label
                htmlFor={approverId}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-status-escalated"
              >
                <PenLine className="size-3.5 shrink-0" aria-hidden />
                Sign-off required from {run.signoffRole ?? 'a human reviewer'}
              </label>
              <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
                Nothing auto-approves an escalation. Enter the name of the person accepting
                responsibility for this run; it is appended to the delta trail as a{' '}
                <span className="font-mono">signoff</span> delta.
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <Input
                  id={approverId}
                  value={approver}
                  onChange={(e) => setApprover(e.currentTarget.value)}
                  placeholder="name of approver"
                  className="h-7 font-mono text-[11px]"
                  autoComplete="off"
                />
                <Button type="submit" size="xs" disabled={busy || approver.trim() === ''}>
                  Record
                </Button>
              </div>
            </form>
          )}

          {run.signoff !== null && (
            <p className="shrink-0 border-b border-border bg-status-pass/8 px-2.5 py-2 text-[11px] text-status-pass">
              <PenLine className="mr-1 inline size-3" aria-hidden />
              Signed off by <span className="font-mono">{run.signoff.approver}</span> as{' '}
              <span className="font-mono">{run.signoff.role}</span>.
            </p>
          )}

          {/* The merge gate. */}
          <div className="mt-auto shrink-0 border-t border-chrome-border bg-chrome/80 px-2.5 py-2">
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
              {run.branch} → {mergeTarget ?? '(no base branch)'}
            </p>
            {merge !== null && (
              <p
                className={`mt-1.5 rounded-md border px-2 py-1.5 text-[11px] leading-snug ${
                  merge.allowed
                    ? 'border-status-pass/30 bg-status-pass/10 text-status-pass'
                    : 'border-status-fail/30 bg-status-fail/10 text-status-fail'
                }`}
              >
                {merge.reason}
              </p>
            )}
            {mergeVcs !== null && (
              <p className="mt-1.5 nums rounded-md border border-border bg-card px-2 py-1.5 font-mono text-[10.5px] leading-snug">
                {mergeVcs}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
