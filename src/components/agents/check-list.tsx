'use client';

import { ChevronRight, GitFork, Info, ListChecks, ShieldCheck } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { CHECK_STATUS } from '@/components/status';
import type { CheckView, DeltaView, RunView } from '@/lib/demo/view';

export interface CheckListProps {
  readonly run: RunView;
}

/**
 * The seven agent checks as a run list, each expandable to its delta. The gate
 * is visually pinned as step 2 of 7 so its position in the pipeline is legible
 * rather than implied (SPEC §4.3, §7.4).
 */
export function CheckList({ run }: CheckListProps) {
  const deltaById = new Map(run.deltas.map((d) => [d.id, d]));
  const total = run.checks.reduce((sum, check) => sum + check.durationMs, 0);
  const verdict = CHECK_STATUS[run.verdict];

  return (
    <section className="flex flex-col gap-3" aria-label="Agent checks">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <ListChecks className="size-4 text-primary" aria-hidden="true" />
          Agent checks
        </h3>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${verdict.pill}`}
        >
          <verdict.Icon className="size-2.5" aria-hidden="true" />
          {run.verdict}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground tnum">
          {run.checks.filter((c) => c.status !== 'skipped').length}/7 ran · {total} ms
        </span>
      </header>

      {/* The policy verdict, always shown, never templated with request text. */}
      <div className="rounded-xl border bg-card/60 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Biosafety screen
        </p>
        <dl className="mt-2 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-[11.5px]">
          <dt className="text-muted-foreground">Category</dt>
          <dd className="font-mono font-medium">{run.policy.category}</dd>
          <dt className="text-muted-foreground">Verdict</dt>
          <dd className="font-mono font-medium">{run.policy.verdict}</dd>
          <dt className="text-muted-foreground">Digest</dt>
          <dd className="font-mono text-muted-foreground tnum">{run.policy.requestDigest}</dd>
          {run.policy.flaggedGenes.length > 0 && (
            <>
              <dt className="text-muted-foreground">Flagged</dt>
              <dd className="font-mono">{run.policy.flaggedGenes.join(', ')}</dd>
            </>
          )}
          {run.policy.signoffRole !== null && (
            <>
              <dt className="text-muted-foreground">Sign-off</dt>
              <dd className="font-mono">{run.policy.signoffRole}</dd>
            </>
          )}
        </dl>
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
          {run.policy.reason}
        </p>
        {run.policy.redacted && (
          <p className="mt-2 flex items-start gap-1.5 rounded-md bg-block-soft/50 px-2 py-1.5 text-[11px] leading-relaxed text-block">
            <Info className="mt-px size-3 shrink-0" aria-hidden="true" />
            This request was refused by category. Its text was never stored, logged or
            rendered — only the digest above identifies it.
          </p>
        )}
        {run.signoff !== null && (
          <p className="mt-2 flex items-start gap-1.5 rounded-md bg-pass-soft/50 px-2 py-1.5 text-[11px] leading-relaxed text-pass">
            <ShieldCheck className="mt-px size-3 shrink-0" aria-hidden="true" />
            Signed off by <span className="font-mono">{run.signoff.by}</span> as{' '}
            <span className="font-mono">{run.signoff.role}</span>.
          </p>
        )}
      </div>

      <ol className="flex flex-col gap-1">
        {run.checks.map((check) => (
          <CheckRow
            key={check.id}
            check={check}
            delta={check.deltaId === null ? null : (deltaById.get(check.deltaId) ?? null)}
            allDeltas={run.deltas}
          />
        ))}
      </ol>

      {run.limitation !== null && (
        <p className="rounded-lg border border-dashed px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <strong className="font-semibold text-foreground">Model limits.</strong>{' '}
          {run.limitation}
        </p>
      )}
    </section>
  );
}

function CheckRow({
  check,
  delta,
  allDeltas,
}: {
  readonly check: CheckView;
  readonly delta: DeltaView | null;
  readonly allDeltas: readonly DeltaView[];
}) {
  const look = CHECK_STATUS[check.status];
  const isGate = check.step === 2;

  return (
    <li>
      <Collapsible>
        <CollapsibleTrigger
          className="group/check flex w-full items-start gap-2.5 rounded-lg border bg-card/50 px-3 py-2 text-left transition-colors hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          disabled={delta === null}
        >
          <span
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: `${look.color}1f`, color: look.color }}
          >
            <look.Icon className="size-3.5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-mono text-[10px] text-muted-foreground tnum">
                {check.step}/7
              </span>
              <span className="text-[12.5px] font-semibold">{check.agent}</span>
              {isGate && (
                <span className="rounded-full bg-primary/12 px-1.5 py-px text-[9.5px] font-semibold tracking-wide text-primary uppercase">
                  gate
                </span>
              )}
              <span
                className={`rounded-full px-1.5 py-px text-[9.5px] font-semibold tracking-wide uppercase ${look.pill}`}
              >
                {check.status}
              </span>
              {check.durationMs > 0 && (
                <span className="ml-auto font-mono text-[10px] text-muted-foreground tnum">
                  {check.durationMs} ms
                </span>
              )}
            </span>
            <span className="mt-0.5 block text-[12px] font-medium">{check.title}</span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
              {check.summary}
            </span>
          </span>
          {delta !== null && (
            <ChevronRight
              className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open/check:rotate-90"
              aria-hidden="true"
            />
          )}
        </CollapsibleTrigger>
        {delta !== null && (
          <CollapsibleContent>
            <div className="mt-1 ml-3 rounded-lg border border-dashed bg-card/30 px-3 py-2.5">
              <p className="flex flex-wrap items-center gap-x-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                <GitFork className="size-3" aria-hidden="true" />
                delta {delta.id}
                <span className="font-mono normal-case">{delta.kind}</span>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                by <span className="font-mono">{delta.author}</span>
                {delta.parents.length > 0 && (
                  <>
                    {' · derived from '}
                    <span className="font-mono">{delta.parents.join(', ')}</span>
                  </>
                )}
              </p>
              {delta.parents.length > 1 && (
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  This delta has {delta.parents.length} parents: the claims it cross-checked.
                  Disagreement forks the record rather than overwriting it.
                </p>
              )}
              <Separator className="my-2" />
              <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1 text-[11px]">
                {delta.fields.map((field) => (
                  <div key={field.label} className="col-span-2 grid grid-cols-subgrid">
                    <dt className="text-muted-foreground">{field.label}</dt>
                    <dd className="font-mono break-words">{field.value}</dd>
                  </div>
                ))}
              </dl>
              <DeltaTrail delta={delta} allDeltas={allDeltas} />
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </li>
  );
}

/** The delta's lineage, so the audit trail is visible per check. */
function DeltaTrail({
  delta,
  allDeltas,
}: {
  readonly delta: DeltaView;
  readonly allDeltas: readonly DeltaView[];
}) {
  const byId = new Map(allDeltas.map((d) => [d.id, d]));
  const keep = new Set<string>();
  const stack = [...delta.parents];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || keep.has(id)) continue;
    keep.add(id);
    for (const parent of byId.get(id)?.parents ?? []) stack.push(parent);
  }
  const lineage = allDeltas.filter((d) => keep.has(d.id));
  if (lineage.length === 0) return null;

  return (
    <>
      <Separator className="my-2" />
      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        Delta trail
      </p>
      <ol className="mt-1 flex flex-col gap-0.5">
        {lineage.map((entry) => (
          <li key={entry.id} className="flex items-center gap-1.5 text-[11px]">
            <span className="font-mono text-muted-foreground">{entry.id}</span>
            <span className="font-mono">{entry.kind}</span>
            <span className="truncate text-muted-foreground">{entry.author}</span>
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-[11px] font-semibold">
          <span className="font-mono">{delta.id}</span>
          <span className="font-mono">{delta.kind}</span>
          <span className="truncate text-muted-foreground">{delta.author}</span>
        </li>
      </ol>
    </>
  );
}
