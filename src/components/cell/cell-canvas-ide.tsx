'use client';

/**
 * The live cell canvas, driven by the real `lib/cellsim` (SPEC §5).
 *
 * A `CellSim` instance is the same engine `runAssay` uses headlessly; this
 * component steps it on animation frames, draws each snapshot in that
 * instance's channel geometry, and reads metrics off the snapshot. The pO2
 * slider calls `setPO2` on the running instance — it changes the physics, not
 * a display scale.
 *
 * In this variant it lives in the bottom panel — a terminal pane, not a hero.
 */

import { Droplet, Gauge, Pause, Play, RotateCcw, Waves } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  CellSim,
  PO2_RANGE,
  SIMULATION_DEFAULTS,
  type SimMetrics,
  type SimSnapshot,
} from '@/lib/cellsim';

export interface CellCanvasProps {
  readonly genotypeLabel: string;
  readonly polymerizationTendency: number;
  readonly defaults: typeof SIMULATION_DEFAULTS;
  readonly pO2Control: typeof PO2_RANGE;
  readonly simulationNote: string;
}

interface CellCanvasRunProps extends CellCanvasProps {
  readonly pO2: number;
  readonly onPO2: (value: number) => void;
}

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
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className={`nums text-[12px] font-semibold ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

function spawnSim(
  defaults: typeof SIMULATION_DEFAULTS,
  polymerizationTendency: number,
  oxygen: number,
): CellSim {
  return new CellSim({
    seed: defaults.seed,
    cellCount: defaults.cellCount,
    pO2: oxygen,
    capillaryConstriction: defaults.capillaryConstriction,
    polymerizationTendency,
  });
}

export function CellCanvas(props: CellCanvasProps) {
  const [pO2, setPO2] = useState(props.defaults.pO2);
  // Remount the run when the genotype or fixture seed changes so a branch
  // switch is a fresh, reproducible population. pO2 lives here so the slider
  // is not reset by that remount.
  const runKey = `${props.defaults.seed}|${props.defaults.cellCount}|${props.defaults.capillaryConstriction}|${props.polymerizationTendency}`;
  return <CellCanvasRun key={runKey} {...props} pO2={pO2} onPO2={setPO2} />;
}

function CellCanvasRun({
  genotypeLabel,
  polymerizationTendency,
  defaults,
  pO2Control,
  simulationNote,
  pO2,
  onPO2,
}: CellCanvasRunProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);

  const [sim, setSim] = useState(() => spawnSim(defaults, polymerizationTendency, pO2));
  const [running, setRunning] = useState(true);
  const [metrics, setMetrics] = useState<SimMetrics>(() => sim.metrics());
  const [tick, setTick] = useState(0);
  const po2LabelId = useId();

  // pO2 changes must not restart the population: the control is for watching
  // the same cells respond.
  useEffect(() => {
    sim.setPO2(pO2);
  }, [pO2, sim]);

  const draw = useCallback((snapshot: SimSnapshot, engine: CellSim) => {
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

    const geom = snapshot.geom;
    const scaleX = cssW / geom.width;
    const scaleY = cssH / geom.height;
    const rScale = Math.min(scaleX, scaleY);
    const toX = (x: number): number => x * scaleX;
    const toY = (y: number): number => y * scaleY;

    // Capillary walls, traced from `sim.halfHeightAt` — the same profile the
    // physics confines cells with — in this snapshot's channel geometry.
    ctx.strokeStyle = wall;
    ctx.lineWidth = 2;
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      for (let px = 0; px <= cssW; px += 2) {
        const simX = (px / cssW) * geom.width;
        const h = engine.halfHeightAt(simX);
        const y = toY(geom.height / 2 + sign * h);
        if (px === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
    }

    for (const cell of snapshot.cells) {
      const cx = toX(cell.x);
      const cy = toY(cell.y);
      const r = cell.radius * rScale;
      ctx.save();
      ctx.translate(cx, cy);
      if (cell.state === 'sickled') {
        // Elongated, stiff crescent, rotated to the cell's heading.
        ctx.rotate(cell.theta);
        ctx.fillStyle = sickled;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.75, r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = discoid;
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.86, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }, []);

  useEffect(() => {
    if (!running) {
      draw(sim.snapshot(), sim);
      return;
    }
    let cancelled = false;
    const loop = (): void => {
      if (cancelled) return;
      const snapshot = sim.step();
      draw(snapshot, sim);
      if (snapshot.tick % 6 === 0) {
        setMetrics(snapshot.metrics);
        setTick(snapshot.tick);
      }
      frameRef.current = requestAnimationFrame(loop);
    };
    frameRef.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [running, draw, sim]);

  const reset = (): void => {
    const next = spawnSim(defaults, polymerizationTendency, pO2);
    setSim(next);
    setMetrics(next.metrics());
    setTick(0);
    draw(next.snapshot(), next);
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
        <span className="nums ml-auto text-[10px] text-muted-foreground">
          {genotypeLabel} · tendency {polymerizationTendency.toFixed(2)} · seed {defaults.seed} ·{' '}
          {defaults.cellCount} cells · step {tick}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        className="min-h-28 w-full flex-1 rounded-md border border-border bg-cell-plasma"
        role="img"
        aria-label={`Capillary flow simulation for ${genotypeLabel}. At pO2 ${pO2} ${pO2Control.unit}, ${(
          metrics.sickledFraction * 100
        ).toFixed(0)}% of cells are sickled and the constriction is ${(metrics.occlusion * 100).toFixed(
          0,
        )}% occluded.`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-60 flex-1 items-center gap-2">
          <span id={po2LabelId} className="shrink-0 text-[11px] text-muted-foreground">
            {pO2Control.label}
          </span>
          <Slider
            value={pO2}
            onValueChange={(v) => onPO2(typeof v === 'number' ? v : (v[0] ?? pO2))}
            min={pO2Control.min}
            max={pO2Control.max}
            step={1}
            className="flex-1"
            // The name has to reach the thumb: that is where role="slider"
            // lives. See the note in components/ui/slider.tsx.
            thumbProps={{
              'aria-label': `${pO2Control.label} in ${pO2Control.unit}`,
              'aria-valuetext': `${pO2} ${pO2Control.unit}`,
            }}
            aria-labelledby={po2LabelId}
          />
          <span className="nums w-[5.5rem] shrink-0 text-[11px]">
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
        <span className="nums">
          {pO2Control.sicklingOnsetBelow} {pO2Control.unit}
        </span>
        ; above it, cells re-oxygenate and relax. These numbers describe this simulation only.
      </p>
    </div>
  );
}
