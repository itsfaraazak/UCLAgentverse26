'use client';

/**
 * The bench. Holds the instrument's state — selected frame, oxygen tension,
 * transport — and wires the canvas, the readouts, the checks and the console
 * together. All data arrives from the server as plain values.
 */

import { useCallback, useState, useTransition } from 'react';
import { CircleDot, Droplet, FlaskConical, Microscope, Waves } from 'lucide-react';
import type { SimMetrics } from '@/lib/cellsim';
import { attemptMergeAction, runChecksAction } from '@/app/bench/actions';
import type { BenchData, CheckRunView, MergeAttemptView } from '@/app/bench/bench-types';
import { CellCanvas } from '@/components/cell/cell-canvas-bench';
import { PO2Control } from '@/components/cell/po2-control';
import { CheckPanel } from '@/components/agents/check-panel';
import { ReadoutStrip, type MetricSample } from '@/components/agents/readout-strip';
import { Filmstrip } from '@/components/diff/filmstrip';
import { GeneTrack } from '@/components/genome-map/gene-track-bench';
import { RedTeamConsole } from '@/components/redteam/redteam-console-bench';
import { LimitsNote } from '@/components/shell/limits-note';
import { TitleBar } from '@/components/shell/titlebar-bench';
import { Badge } from '@/components/ui/badge';

const HISTORY = 170;
const ZERO: SimMetrics = { occlusion: 0, meanFlow: 0, sickledFraction: 0 };

export function BenchApp({ data }: { data: BenchData }) {
  const [frameId, setFrameId] = useState(data.frames[1]?.id ?? data.frames[0].id);
  const [pO2, setPO2] = useState(data.simulation.pO2Default);
  const [running, setRunning] = useState(true);
  const [metrics, setMetrics] = useState<SimMetrics>(ZERO);
  const [tick, setTick] = useState(0);
  const [history, setHistory] = useState<MetricSample[]>([]);
  const [runs, setRuns] = useState<Record<string, CheckRunView>>({});
  const [merges, setMerges] = useState<Record<string, MergeAttemptView>>({});
  const [signedOff, setSignedOff] = useState<Record<string, boolean>>({});
  const [checksPending, startChecks] = useTransition();
  const [mergePending, startMerge] = useTransition();

  const frame = data.frames.find((f) => f.id === frameId) ?? data.frames[0];

  /**
   * Flow reference: mean flow for a genotype with no polymerization
   * tendency, measured server-side by `runAssay` once per render. Every
   * "% of reference" reading on the bench is against this one figure.
   */
  const baselineMeanFlow = data.simulation.referenceMeanFlow;

  /** A frame change re-seeds the population, so the old trace goes with it. */
  const selectFrame = useCallback(
    (id: string) => {
      if (id === frameId) return;
      setFrameId(id);
      setHistory([]);
      setMetrics(ZERO);
    },
    [frameId],
  );

  const onMetrics = useCallback(
    (next: SimMetrics, nextTick: number) => {
      setMetrics(next);
      setTick(nextTick);
      setHistory((prev) => {
        const sample: MetricSample = {
          tick: nextTick,
          occlusion: next.occlusion,
          flowRatio: baselineMeanFlow > 0 ? next.meanFlow / baselineMeanFlow : 0,
          sickledFraction: next.sickledFraction,
        };
        const out = prev.length >= HISTORY ? prev.slice(prev.length - HISTORY + 1) : prev.slice();
        out.push(sample);
        return out;
      });
    },
    [baselineMeanFlow],
  );

  const onRunChecks = useCallback(() => {
    startChecks(async () => {
      const result = await runChecksAction(frame.id, Math.round(pO2));
      setRuns((prev) => ({ ...prev, [frame.id]: result }));
    });
  }, [frame.id, pO2]);

  const onMerge = useCallback(() => {
    startMerge(async () => {
      const result = await attemptMergeAction(
        frame.id,
        Math.round(pO2),
        signedOff[frame.id] === true,
      );
      setMerges((prev) => ({ ...prev, [frame.id]: result }));
    });
  }, [frame.id, pO2, signedOff]);

  const flowRatio = baselineMeanFlow > 0 ? metrics.meanFlow / baselineMeanFlow : 0;
  const run = runs[frame.id] ?? null;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TitleBar
        branches={data.branches}
        branch={frame.branch}
        onBranchChange={(branch) => {
          const next = data.frames.find((f) => f.branch === branch);
          if (next !== undefined) selectFrame(next.id);
        }}
        running={running}
        onRunningChange={setRunning}
        subtitle={`${data.locus.gene} · ${frame.label} · ${data.locus.referenceLabel}`}
      />

      <main className="grid flex-1 grid-cols-1 items-start gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-4">
          {/* Hero: the live capillary. */}
          <section
            aria-labelledby="canvas-heading"
            className="bezel-surface overflow-hidden rounded-xl border border-bezel-edge/70 p-1.5"
          >
            <h2 id="canvas-heading" className="sr-only">
              Live capillary simulation
            </h2>
            {/* The channel is 480 × 100 in simulation units; the hero keeps that
                aspect so the capillary is not stretched out of shape. */}
            <div className="engraved-grid relative aspect-[24/5] max-h-[52vh] min-h-[240px] w-full overflow-hidden rounded-lg bg-background">
              <CellCanvas
                seed={data.simulation.seed}
                cellCount={data.simulation.cellCount}
                pO2={pO2}
                polymerizationTendency={frame.polymerizationTendency}
                capillaryConstriction={data.simulation.capillaryConstriction}
                generation={frame.id}
                running={running}
                onMetrics={onMetrics}
              />

              <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="vibrancy-surface rounded-lg border border-border/70 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-[0.625rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                      <Microscope className="size-3" aria-hidden="true" />
                      Genotype
                    </p>
                    <p className="text-sm font-semibold">{frame.label}</p>
                    <p className="tnum font-mono text-[0.625rem] text-muted-foreground">
                      {frame.branch} · {frame.shortOid}
                    </p>
                  </div>

                  <dl className="vibrancy-surface tnum grid grid-cols-3 gap-x-4 rounded-lg border border-border/70 px-3 py-2 font-mono">
                    <div>
                      <dt className="text-[0.5625rem] tracking-[0.1em] text-muted-foreground uppercase">
                        Occl
                      </dt>
                      <dd className="text-base font-semibold">{metrics.occlusion.toFixed(3)}</dd>
                    </div>
                    <div>
                      <dt className="text-[0.5625rem] tracking-[0.1em] text-muted-foreground uppercase">
                        Flow
                      </dt>
                      <dd className="text-base font-semibold">
                        {(flowRatio * 100).toFixed(0)}
                        <span className="text-[0.625rem] font-normal text-muted-foreground">
                          % ref
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[0.5625rem] tracking-[0.1em] text-muted-foreground uppercase">
                        Sickled
                      </dt>
                      <dd className="text-base font-semibold">
                        {(metrics.sickledFraction * 100).toFixed(0)}
                        <span className="text-[0.625rem] font-normal text-muted-foreground">%</span>
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="flex flex-wrap items-end justify-between gap-2">
                  <ul className="vibrancy-surface flex flex-wrap items-center gap-3 rounded-lg border border-border/70 px-3 py-1.5 text-[0.625rem]">
                    <li className="flex items-center gap-1.5">
                      <Droplet
                        className="size-3 text-[var(--cell-discoid)]"
                        aria-hidden="true"
                      />
                      discoid
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CircleDot
                        className="size-3 text-[var(--cell-sickled)]"
                        aria-hidden="true"
                      />
                      sickled
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Waves className="size-3 text-signal" aria-hidden="true" />
                      flow trail
                    </li>
                    <li className="tnum font-mono text-muted-foreground">
                      seed {data.simulation.seed} · step {tick}
                    </li>
                  </ul>
                  <Badge variant="outline" className="vibrancy-surface">
                    <FlaskConical className="size-3" aria-hidden="true" />
                    Illustrative model — not calibrated haemorheology
                  </Badge>
                </div>
              </div>
            </div>
          </section>

          <PO2Control
            value={pO2}
            min={data.simulation.pO2Min}
            max={data.simulation.pO2Max}
            unit={data.simulation.pO2Unit}
            label={data.simulation.pO2Label}
            onsetBelow={data.simulation.sicklingOnsetBelow}
            onChange={setPO2}
          />

          <GeneTrack
            locus={data.locus}
            markerCodon={frame.changedCodonIndex}
            markerLabel={frame.variantLabel}
            refCodon={frame.structural === null ? null : frame.diffFromPrevious.find((r) => r.status === 'changed')?.refCodon ?? null}
            altCodon={frame.structural === null ? null : frame.diffFromPrevious.find((r) => r.status === 'changed')?.altCodon ?? null}
            refAa={frame.structural?.refAa ?? null}
            altAa={frame.structural?.altAa ?? null}
          />

          <Filmstrip frames={data.frames} selectedId={frame.id} onSelect={selectFrame} />

          <LimitsNote
            disclaimer={data.disclaimer}
            seed={data.simulation.seed}
            cellCount={data.simulation.cellCount}
            constriction={data.simulation.capillaryConstriction}
            onsetBelow={data.simulation.sicklingOnsetBelow}
            unit={data.simulation.pO2Unit}
          />
        </div>

        <div className="space-y-4 lg:sticky lg:top-[4.25rem]">
          <ReadoutStrip
            metrics={metrics}
            tick={tick}
            baselineMeanFlow={baselineMeanFlow}
            history={history}
            genotypeLabel={frame.label}
            pO2={pO2}
            pO2Unit={data.simulation.pO2Unit}
            occlusionLimit={0.25}
            sickledLimit={0.2}
            flowFloor={0.6}
          />

          <CheckPanel
            run={run}
            pending={checksPending}
            onRun={onRunChecks}
            onMerge={onMerge}
            merge={merges[frame.id] ?? null}
            mergePending={mergePending}
            signedOff={signedOff[frame.id] === true}
            onSignOff={() => setSignedOff((prev) => ({ ...prev, [frame.id]: true }))}
            frameLabel={frame.label}
            branch={frame.branch}
          />

          <RedTeamConsole />
        </div>
      </main>
    </div>
  );
}
