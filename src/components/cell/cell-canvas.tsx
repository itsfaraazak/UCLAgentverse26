'use client';

/**
 * The live cell canvas, driven by the real `lib/cellsim` (SPEC §5).
 *
 * `createSim`/`step` are the same pure functions `FunctionalAssayAgent` calls
 * headlessly; this component only draws the state they return and reads the
 * metrics off it. The pO2 slider changes the simulation parameters, not a
 * display scale.
 *
 * In this variant it lives in the bottom panel — a terminal pane, not a hero.
 */

import { Droplet, Gauge, Pause, Play, RotateCcw, Waves } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  channelHalfHeight,
  createSim,
  step,
  type SimMetrics,
  type SimParams,
  type SimState,
} from '@/lib/cellsim';
import type { PO2Control, SimulationDefaults } from '@/lib/loci';

export interface CellCanvasProps {
  readonly genotypeLabel: string;
  readonly polymerizationTendency: number;
  readonly defaults: SimulationDefaults;
  readonly pO2Control: PO2Control;
  readonly simulationNote: string;
}

const ZERO: SimMetrics = { occlusion: 0, meanFlow: 0, sickledFraction: 0 };

function Readout({
  icon: Icon,
  label,
  value,
  tone,
}: {
  readonly icon: typeof Gauge;
  readonly label: string;
  readonly value: string;
  readonly tone?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className={`nums font-mono text-[12px] font-semibold ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

export function CellCanvas({
  genotypeLabel,
  polymerizationTendency,
  defaults,
  pO2Control,
  simulationNote,
}: CellCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<SimState | null>(null);
  const frameRef = useRef<number | null>(null);

  const [pO2, setPO2] = useState(defaults.pO2);
  const [running, setRunning] = useState(true);
  const [metrics, setMetrics] = useState<SimMetrics>(ZERO);
  const [tick, setTick] = useState(0);

  const params: SimParams = useMemo(
    () => ({
      seed: defaults.seed,
      cellCount: defaults.cellCount,
      pO2,
      constriction: defaults.capillaryConstriction,
      polymerizationTendency,
    }),
    [defaults.seed, defaults.cellCount, defaults.capillaryConstriction, pO2, polymerizationTendency],
  );

  // Re-seed whenever the genotype changes so a branch switch is a fresh,
  // reproducible run rather than a continuation of the previous genotype.
  useEffect(() => {
    stateRef.current = createSim({
      seed: defaults.seed,
      cellCount: defaults.cellCount,
      pO2,
      constriction: defaults.capillaryConstriction,
      polymerizationTendency,
    });
    setMetrics(stateRef.current.metrics);
    setTick(0);
    // Deliberately keyed on genotype + seed only: changing pO2 must perturb a
    // running simulation, not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polymerizationTendency, defaults.seed, defaults.cellCount, defaults.capillaryConstriction]);

  const draw = useCallback((state: SimState) => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio, 2);
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const read = (token: string, fallback: string): string => {
      const v = getComputedStyle(canvas).getPropertyValue(token).trim();
      return v === '' ? fallback : v;
    };
    const plasma = read('--cell-plasma', '#f8fafc');
    const wall = read('--cell-wall', '#d4d4d8');
    const discoid = read('--cell-discoid', '#dc5a4a');
    const sickled = read('--cell-sickled', '#7c4dcc');

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = plasma;
    ctx.fillRect(0, 0, cssW, cssH);

    const midY = cssH / 2;
    const maxHalf = cssH / 2 - 4;
    const toX = (x: number): number => x * cssW;
    const toY = (y: number): number => midY + y * maxHalf;

    // Capillary walls, traced from the same `channelHalfHeight` the physics
    // uses — the drawing cannot disagree with the model.
    ctx.strokeStyle = wall;
    ctx.lineWidth = 2;
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      for (let px = 0; px <= cssW; px += 2) {
        const h = channelHalfHeight(px / cssW, params.constriction);
        const y = midY + sign * h * maxHalf;
        if (px === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
    }

    for (const cell of state.cells) {
      const cx = toX(cell.x);
      const cy = toY(cell.y);
      ctx.save();
      ctx.translate(cx, cy);
      if (cell.state === 'sickled') {
        // Elongated, stiff crescent.
        ctx.rotate(Math.PI / 5);
        ctx.fillStyle = sickled;
        ctx.beginPath();
        ctx.ellipse(0, 0, 6.5, 1.9, 0, 0, Math.PI * 2);
        ctx.fill();
        if (cell.jammed) {
          ctx.strokeStyle = sickled;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(0, 0, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = discoid;
        ctx.beginPath();
        ctx.ellipse(0, 0, 3.6, 3.1, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }, [params.constriction]);

  useEffect(() => {
    if (!running) {
      if (stateRef.current !== null) draw(stateRef.current);
      return;
    }
    let cancelled = false;
    const loop = (): void => {
      if (cancelled) return;
      const current = stateRef.current;
      if (current !== null) {
        const advanced = step({ ...current, params });
        stateRef.current = advanced;
        draw(advanced);
        if (advanced.tick % 6 === 0) {
          setMetrics(advanced.metrics);
          setTick(advanced.tick);
        }
      }
      frameRef.current = requestAnimationFrame(loop);
    };
    frameRef.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [running, draw, params]);

  const reset = (): void => {
    stateRef.current = createSim(params);
    setMetrics(stateRef.current.metrics);
    setTick(0);
    draw(stateRef.current);
  };

  const occlusionTone =
    metrics.occlusion > 0.4
      ? 'text-status-fail'
      : metrics.occlusion > 0.15
        ? 'text-status-warn'
        : 'text-status-pass';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Readout icon={Gauge} label="occlusion" value={`${(metrics.occlusion * 100).toFixed(1)}%`} tone={occlusionTone} />
        <Readout icon={Waves} label="mean flow" value={metrics.meanFlow.toFixed(5)} />
        <Readout
          icon={Droplet}
          label="sickled"
          value={`${(metrics.sickledFraction * 100).toFixed(1)}%`}
          tone={metrics.sickledFraction > 0.3 ? 'text-status-fail' : undefined}
        />
        <span className="nums ml-auto font-mono text-[10px] text-muted-foreground">
          {genotypeLabel} · tendency {polymerizationTendency.toFixed(2)} · seed {defaults.seed} ·{' '}
          {defaults.cellCount} cells · step {tick}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        className="min-h-[110px] w-full flex-1 rounded-md border border-border bg-cell-plasma"
        role="img"
        aria-label={`Capillary flow simulation for ${genotypeLabel}. At pO2 ${pO2} ${pO2Control.unit}, ${(
          metrics.sickledFraction * 100
        ).toFixed(0)}% of cells are sickled and the constriction is ${(metrics.occlusion * 100).toFixed(
          0,
        )}% occluded.`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[15rem] flex-1 items-center gap-2">
          <Label htmlFor="po2-slider" className="shrink-0 text-[11px] text-muted-foreground">
            {pO2Control.label}
          </Label>
          <Slider
            id="po2-slider"
            value={pO2}
            onValueChange={(v) => setPO2(typeof v === 'number' ? v : (v[0] ?? pO2))}
            min={pO2Control.min}
            max={pO2Control.max}
            step={1}
            className="flex-1"
            aria-label={`${pO2Control.label} in ${pO2Control.unit}`}
            aria-valuetext={`${pO2} ${pO2Control.unit}`}
          />
          <span className="nums w-[5.5rem] shrink-0 font-mono text-[11px]">
            {pO2} {pO2Control.unit}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon-xs" variant="outline" onClick={() => setRunning((v) => !v)}>
            {running ? <Pause aria-hidden /> : <Play aria-hidden />}
            <span className="sr-only">{running ? 'Pause simulation' : 'Resume simulation'}</span>
          </Button>
          <Button size="icon-xs" variant="outline" onClick={reset}>
            <RotateCcw aria-hidden />
            <span className="sr-only">Reset simulation to its seed</span>
          </Button>
        </div>
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        <span className="font-semibold">Illustrative model, not validated haemorheology.</span>{' '}
        {simulationNote} Sickling becomes likely below{' '}
        <span className="nums font-mono">
          {pO2Control.sicklingOnsetBelow} {pO2Control.unit}
        </span>
        ; above it, cells re-oxygenate and relax. These numbers describe this simulation only.
      </p>
    </div>
  );
}
