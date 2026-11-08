'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { FastForward, Info, Pause, Play, Scan, StepForward } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { ASSAY_MODEL_LIMITATION, SIMULATION_DEFAULTS } from '@/lib/cellsim';
import { SimDriver } from './driver';
import { loadCellEngine } from './load-engine';
import {
  BAND_TEXT,
  OCCLUSION_BANDS,
  flow,
  metricsFromSnapshot,
  occlusionBand,
  percent,
  type CellFlowMetrics,
} from './metrics';
import { classifyFailure, describe, isAbort, type FailureKind } from '@/components/protein/runtime/errors';
import { usePrefersReducedMotion } from '@/components/protein/runtime/motion';
import { FailurePanel, LoadingOverlay, RendererBadge } from '@/components/protein/runtime/status-ui';
import type { RendererPreference } from '@/components/protein/runtime/renderer';
import type { CellEngineHandle, RendererInfo } from './engine';

export interface CellFlow3DProps {
  /** Oxygen tension, mmHg. Clamped by `lib/cellsim` to its fixture range. */
  readonly pO2: number;
  /** Genotype-derived, 0–1 (see `loci.json` genotypes). */
  readonly polymerizationTendency: number;
  /** Simulation seed. Changing it restarts the simulation. */
  readonly seed?: number;
  readonly cellCount?: number;
  readonly capillaryConstriction?: number;
  /** Receives the simulation's own metrics a few times a second, and on
   *  every step/settle while paused. */
  readonly onMetrics?: (metrics: CellFlowMetrics) => void;
  /** Start paused. Defaults to the viewer's `prefers-reduced-motion`. */
  readonly paused?: boolean;
  /** `'webgl'` forces the WebGL 2 path (e.g. to rehearse the fallback). */
  readonly renderer?: RendererPreference;
  readonly onRendererChange?: (info: RendererInfo | null) => void;
  readonly className?: string;
}

type EngineState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly renderer: RendererInfo }
  | { readonly phase: 'error'; readonly kind: FailureKind; readonly detail: string };

/** Publish metrics to React/host every N ticks while playing (~4 Hz at 60 steps/s). */
const METRICS_EVERY = 15;
/** Ticks run when settling a paused view so the still frame reflects params. */
export const SETTLE_TICKS = 120;

export function CellFlow3D({
  pO2,
  polymerizationTendency,
  seed = SIMULATION_DEFAULTS.seed,
  cellCount = SIMULATION_DEFAULTS.cellCount,
  capillaryConstriction = SIMULATION_DEFAULTS.capillaryConstriction,
  onMetrics,
  paused,
  renderer: prefer = 'auto',
  onRendererChange,
  className,
}: CellFlow3DProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [userPlaying, setUserPlaying] = useState<boolean | null>(null);
  const playing = userPlaying ?? (paused === undefined ? !reducedMotion : !paused);

  const [live, setLive] = useState<CellFlowMetrics | null>(null);
  const [attempt, setAttempt] = useState(0);
  const driverKey = `${seed}|${cellCount}|${capillaryConstriction}`;
  const engineKey = `${driverKey}|${prefer}|${attempt}`;
  const [tagged, setTagged] = useState<{ key: string; state: EngineState } | null>(null);
  const engine: EngineState = tagged !== null && tagged.key === engineKey ? tagged.state : { phase: 'loading' };

  const hostRef = useRef<HTMLDivElement>(null);
  const driverRef = useRef<SimDriver | null>(null);
  const engineRef = useRef<CellEngineHandle | null>(null);
  const onMetricsRef = useRef(onMetrics);
  const rendererCb = useRef(onRendererChange);
  const applied = useRef<{ driver: SimDriver | null; pO2: number; poly: number }>({
    driver: null,
    pO2,
    poly: polymerizationTendency,
  });
  useEffect(() => {
    onMetricsRef.current = onMetrics;
    rendererCb.current = onRendererChange;
  }, [onMetrics, onRendererChange]);

  const ids = { title: useId(), metrics: useId() };

  // A. The simulation. Lives independently of the renderer, so if the 3D
  //    view cannot start the metrics below still come from a running sim.
  useEffect(() => {
    const driver = new SimDriver({
      seed,
      cellCount,
      capillaryConstriction,
      // Real params are applied by effect B before the first step.
      pO2: SIMULATION_DEFAULTS.pO2,
      polymerizationTendency: 0,
    });
    driverRef.current = driver;
    let lastPublished = -Infinity;
    const unsubscribe = driver.subscribe((snapshot) => {
      engineRef.current?.draw(snapshot);
      if (driver.playing && snapshot.tick - lastPublished < METRICS_EVERY) return;
      lastPublished = snapshot.tick;
      const metrics = metricsFromSnapshot(snapshot);
      setLive(metrics);
      onMetricsRef.current?.(metrics);
    });
    return () => {
      unsubscribe();
      driver.dispose();
      if (driverRef.current === driver) driverRef.current = null;
    };
  }, [seed, cellCount, capillaryConstriction]);

  // B. Parameters. Applied in place — the cells keep their state, exactly as
  //    a slider drag on the 2D canvas would. While paused, a change settles
  //    the sim forward so the still frame actually reflects it.
  useEffect(() => {
    const driver = driverRef.current;
    if (driver === null) return;
    driver.setPO2(pO2);
    driver.setPolymerizationTendency(polymerizationTendency);
    const prev = applied.current;
    const changed =
      prev.driver === driver && (prev.pO2 !== pO2 || prev.poly !== polymerizationTendency);
    applied.current = { driver, pO2, poly: polymerizationTendency };
    if (changed && !driver.playing) driver.advance(SETTLE_TICKS);
  }, [pO2, polymerizationTendency, driverKey]);

  // C. Play / pause. A view that starts paused (reduced motion) settles
  //    first, so the still frame is a real simulated state, not the seed grid.
  useEffect(() => {
    const driver = driverRef.current;
    if (driver === null) return;
    if (playing) {
      driver.play();
    } else {
      driver.pause();
      if (driver.snapshot.tick === 0) driver.advance(SETTLE_TICKS);
    }
  }, [playing, driverKey]);

  // D. The renderer.
  useEffect(() => {
    const container = hostRef.current;
    const driver = driverRef.current;
    if (container === null || driver === null) return;
    const controller = new AbortController();
    const { signal } = controller;
    let handle: CellEngineHandle | null = null;
    const setState = (state: EngineState): void => setTagged({ key: engineKey, state });

    const fail = (err: unknown): void => {
      if (signal.aborted || isAbort(err)) return;
      handle?.dispose();
      handle = null;
      engineRef.current = null;
      rendererCb.current?.(null);
      setState({ phase: 'error', kind: classifyFailure(err), detail: describe(err) });
    };

    void (async () => {
      try {
        const mod = await loadCellEngine();
        if (signal.aborted) return;
        const mounted = await mod.mountCellEngine({
          container,
          initial: driver.snapshot,
          prefer,
          signal,
          onContextLost: fail,
        });
        if (signal.aborted) {
          mounted.dispose();
          return;
        }
        handle = mounted;
        engineRef.current = mounted;
        mounted.draw(driver.snapshot);
        rendererCb.current?.(mounted.renderer);
        setState({ phase: 'ready', renderer: mounted.renderer });
      } catch (err) {
        fail(err);
      }
    })();

    return () => {
      controller.abort();
      handle?.dispose();
      handle = null;
      engineRef.current = null;
    };
  }, [engineKey, prefer]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const step = (n: number): void => {
    driverRef.current?.advance(n);
  };

  const band = live === null ? null : occlusionBand(live.occlusion);
  const metricsText =
    live === null
      ? 'Simulation starting.'
      : `${band === null ? '' : BAND_TEXT[band]}. Occlusion ${percent(live.occlusion)}, mean flow ${flow(live.meanFlow)}, sickled ${percent(live.sickledFraction)}.`;

  return (
    <section
      aria-labelledby={ids.title}
      data-slot="cell-flow-3d"
      className={cn(
        'flex w-full min-w-0 flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-zinc-900',
        'dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100',
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id={ids.title} className="text-sm font-semibold leading-tight">
            Capillary flow · 3D
          </h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Illustrative model, not validated haemorheology</p>
        </div>
        <RendererBadge
          state={
            engine.phase === 'ready'
              ? { phase: 'active', ...engine.renderer }
              : engine.phase === 'loading'
                ? { phase: 'starting' }
                : { phase: 'none' }
          }
        />
      </header>

      <div className="relative aspect-[16/7] min-h-[180px] w-full overflow-hidden rounded-lg bg-gradient-to-b from-rose-50/60 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950">
        <div
          ref={hostRef}
          role="img"
          aria-label={`3D rendering of the simulated capillary. ${metricsText}`}
          aria-describedby={ids.metrics}
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
        />
        {engine.phase === 'loading' && <LoadingOverlay label="Starting GPU renderer…" />}
        {engine.phase === 'error' && (
          <FailurePanel kind={engine.kind} detail={engine.detail} onRetry={retry}>
            <p>The simulation is still running; its live metrics are shown below as text.</p>
            <p className="mt-1 font-mono">{metricsText}</p>
          </FailurePanel>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Simulation controls">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setUserPlaying(!playing)}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={playing} onClick={() => step(1)}>
          <StepForward aria-hidden="true" />
          Step
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={playing} onClick={() => step(SETTLE_TICKS)}>
          <FastForward aria-hidden="true" />
          +{SETTLE_TICKS} ticks
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={engine.phase !== 'ready'}
          onClick={() => engineRef.current?.resetView()}
        >
          <Scan aria-hidden="true" />
          Reset view
        </Button>
        {reducedMotion && (
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Reduced motion: starts paused</span>
        )}
      </div>

      <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-700 dark:text-zinc-300">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-full bg-[#dc2626]" />
          Discoid cell (round)
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-1.5 w-3.5 rounded-full bg-[#7c3aed]" />
          Sickled cell (crescent)
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-1.5 w-3.5 rounded-full bg-[#f59e0b]" />
          Sickled and stalled in the constriction
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-full border-2 border-[#f97316]" />
          Constriction ring — turns orange as occlusion rises
        </li>
      </ul>

      <div id={ids.metrics} className="grid gap-2 border-t border-zinc-200 pt-2 text-xs dark:border-zinc-800">
        <p aria-live="polite" className="font-medium">
          {band === null ? 'Simulation starting…' : BAND_TEXT[band]}
        </p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono tabular-nums sm:grid-cols-3">
          <div>
            <dt className="font-sans text-zinc-500 dark:text-zinc-400">Occlusion</dt>
            <dd>{live === null ? '—' : percent(live.occlusion)}</dd>
          </div>
          <div>
            <dt className="font-sans text-zinc-500 dark:text-zinc-400">Mean flow</dt>
            <dd>{live === null ? '—' : `${flow(live.meanFlow)} u/tick`}</dd>
          </div>
          <div>
            <dt className="font-sans text-zinc-500 dark:text-zinc-400">Sickled</dt>
            <dd>{live === null ? '—' : percent(live.sickledFraction)}</dd>
          </div>
          <div>
            <dt className="font-sans text-zinc-500 dark:text-zinc-400">pO₂</dt>
            <dd>{live === null ? '—' : `${live.pO2.toFixed(0)} mmHg`}</dd>
          </div>
          <div>
            <dt className="font-sans text-zinc-500 dark:text-zinc-400">Polymerisation</dt>
            <dd>{live === null ? '—' : live.polymerizationTendency.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="font-sans text-zinc-500 dark:text-zinc-400">Tick</dt>
            <dd>{live === null ? '—' : live.tick}</dd>
          </div>
        </dl>
        <p className="flex gap-2 rounded-md bg-zinc-100 p-2 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {ASSAY_MODEL_LIMITATION} The simulation is two-dimensional: cells move in the vessel’s mid-plane and the
            tube’s depth is drawn for legibility only. The clear / partly blocked / jammed wording uses display
            thresholds ({percent(OCCLUSION_BANDS.partial)}, {percent(OCCLUSION_BANDS.jammed)} occlusion) chosen for
            this view, not clinical cut-offs. Every frame is a real <code>step()</code> of <code>lib/cellsim</code>;
            nothing is interpolated.
          </span>
        </p>
      </div>
    </section>
  );
}
