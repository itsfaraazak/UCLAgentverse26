'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import { ShieldX, Info } from 'lucide-react';
import { Titlebar } from '@/components/shell/titlebar-graph';
import { CommitGraph } from '@/components/graph/commit-graph';
import { BranchRail } from '@/components/graph/branch-rail';
import { MergeGate } from '@/components/graph/merge-gate';
import { InspectorSheet } from '@/components/inspector/inspector-sheet';
import { RedteamConsole } from '@/components/redteam/redteam-console-graph';
import { Separator } from '@/components/ui/separator';
import { attemptMerge, signOff } from '@/app/graph/actions';
import type { ConsoleRunView, MergeOutcome, ScenarioView } from '@/lib/demo/view';

export interface WorkspaceProps {
  readonly initial: ScenarioView;
}

export function Workspace({ initial }: WorkspaceProps) {
  const [scenario, setScenario] = useState(initial);
  const [selectedOid, setSelectedOid] = useState<string | null>(
    initial.graph.nodes[0]?.oid ?? null,
  );
  const [comparedOid, setComparedOid] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [outcome, setOutcome] = useState<MergeOutcome | null>(null);
  const [refusals, setRefusals] = useState<readonly ConsoleRunView[]>([]);
  const [pending, startTransition] = useTransition();

  const session = useMemo(
    () => ({ appliedMerges: scenario.appliedMerges, signoffs: scenario.signoffs }),
    [scenario.appliedMerges, scenario.signoffs],
  );

  const commitByOid = useMemo(
    () => new Map(scenario.commits.map((c) => [c.oid, c])),
    [scenario.commits],
  );

  const headBranch =
    scenario.branches.find((b) => b.name === scenario.headBranch) ?? scenario.branches[0];
  const comparedBranch =
    comparedOid === null
      ? null
      : (scenario.branches.find((b) => b.tip === comparedOid && !b.isHead) ?? null);

  const selectedCommit = selectedOid === null ? null : (commitByOid.get(selectedOid) ?? null);

  const onSelect = useCallback((oid: string) => {
    setSelectedOid(oid);
  }, []);

  const onOpen = useCallback((oid: string) => {
    setSelectedOid(oid);
    setInspectorOpen(true);
  }, []);

  const onCompare = useCallback((oid: string) => {
    setComparedOid((previous) => (previous === oid ? null : oid));
    setOutcome(null);
  }, []);

  const onMerge = useCallback(() => {
    if (comparedBranch === null || headBranch === undefined) return;
    startTransition(async () => {
      const result = await attemptMerge(session, {
        into: headBranch.name,
        from: comparedBranch.name,
      });
      setOutcome(result);
      if (result.kind === 'clean') {
        setScenario(result.scenario);
        setSelectedOid(result.mergeOid);
        setComparedOid(null);
      }
    });
  }, [comparedBranch, headBranch, session]);

  const onSignOff = useCallback(
    (branch: string, by: string) => {
      startTransition(async () => {
        const result = await signOff(session, branch, by);
        if (result.ok) {
          setScenario(result.scenario);
          setOutcome(null);
        } else {
          setOutcome({
            kind: 'blocked',
            into: scenario.headBranch,
            from: branch,
            reason: result.reason,
            category: 'SIGNOFF_REFUSED',
            verdict: 'blocked',
            requiresSignoffBy: null,
          });
        }
      });
    },
    [scenario.headBranch, session],
  );

  const onRefusal = useCallback((entry: ConsoleRunView) => {
    setRefusals((previous) => [entry, ...previous.filter((e) => e.id !== entry.id)].slice(0, 4));
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Titlebar
        repoName={`${scenario.locus.gene}-therapeutic-edit`}
        headBranch={scenario.headBranch}
        commitCount={scenario.commits.length}
        branchCount={scenario.branches.length}
      />

      <div className="flex min-h-0 flex-1">
        {/* ── Left rail: refs + red-team console ───────────────────────── */}
        <aside className="vibrancy hidden w-[21rem] shrink-0 flex-col overflow-hidden border-r lg:flex">
          <div className="shrink-0 overflow-auto">
            <BranchRail
              branches={scenario.branches}
              graph={scenario.graph}
              selectedOid={selectedOid}
              comparedOid={comparedOid}
              onSelect={onSelect}
              onCompare={onCompare}
            />
            <Separator />
            <LocusCard scenario={scenario} />
            <Separator />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <RedteamConsole onRefusal={onRefusal} />
          </div>
        </aside>

        {/* ── Centre: the graph is the canvas ──────────────────────────── */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {refusals.length > 0 && <RefusalStrip refusals={refusals} onClear={() => setRefusals([])} />}
          <CommitGraph
            graph={scenario.graph}
            commits={scenario.commits}
            selectedOid={selectedOid}
            comparedOid={comparedOid}
            onSelect={onSelect}
            onOpen={onOpen}
            onCompare={onCompare}
          />
          {headBranch !== undefined && (
            <MergeGate
              into={headBranch}
              from={comparedBranch}
              outcome={outcome}
              pending={pending}
              onMerge={onMerge}
              onSignOff={onSignOff}
              onDismiss={() => setOutcome(null)}
            />
          )}
        </main>
      </div>

      <InspectorSheet
        commit={selectedCommit}
        locus={scenario.locus}
        simulation={scenario.simulation}
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
      />
    </div>
  );
}

/**
 * Refused console submissions surface here rather than vanishing, so a refusal
 * is visible in the graph view as a rejected state. Category and reason only —
 * never the request text, which the server does not return.
 */
function RefusalStrip({
  refusals,
  onClear,
}: {
  readonly refusals: readonly ConsoleRunView[];
  readonly onClear: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-block/30 bg-block-soft/50 px-4 py-2"
    >
      <ShieldX className="size-3.5 shrink-0 text-block" aria-hidden="true" />
      <span className="text-[11.5px] font-semibold text-block">
        {refusals.length} request{refusals.length === 1 ? '' : 's'} refused and not committed
      </span>
      <ul className="flex min-w-0 flex-wrap items-center gap-1.5">
        {refusals.map((entry, index) => (
          <li
            key={`${entry.id}-${index}`}
            className="rounded-full bg-card px-2 py-px font-mono text-[10px] text-block"
          >
            {entry.run.policy.category}
            <span className="ml-1.5 text-foreground/50 tnum">{entry.run.policy.requestDigest}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto rounded-sm px-1.5 py-0.5 text-[11px] text-block underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Dismiss
      </button>
    </div>
  );
}

function LocusCard({ scenario }: { readonly scenario: ScenarioView }) {
  const { locus } = scenario;
  return (
    <section className="flex flex-col gap-1.5 p-3" aria-label="Locus under edit">
      <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        Locus
      </h2>
      <p className="text-[12.5px] font-semibold">
        <span className="font-mono">{locus.gene}</span>
        <span className="ml-1.5 font-normal text-muted-foreground">chr{locus.chromosome}</span>
      </p>
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">{locus.name}</p>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <dt className="text-muted-foreground">Reference</dt>
        <dd className="truncate font-mono">{locus.referenceLabel}</dd>
        <dt className="text-muted-foreground">Modelled</dt>
        <dd className="font-mono tnum">
          codons 1–{locus.codonCount} of {locus.totalCodons}
        </dd>
        <dt className="text-muted-foreground">Provenance</dt>
        <dd className="font-mono">{locus.provenance}</dd>
      </dl>
      <p className="flex items-start gap-1.5 rounded-lg border border-dashed px-2.5 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Illustrative prototype. The simulation is not validated haemorheology and the
          structural annotations are textbook teaching summaries, not predictions. No construct
          designs, guides, primers, vectors or protocols appear anywhere in this tool.
        </span>
      </p>
    </section>
  );
}
