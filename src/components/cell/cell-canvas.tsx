'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Pause, Play, RotateCcw, Waves } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  channelHalfHeight,
  createSim,
  step,
  type CellSimParams,
  type SimState,
} from '@/lib/cellsim';
import type { SimulationView } from '@/lib/demo/view';

export interface CellCanvasProps {
  readonly simulation: SimulationView;
  readonly polymerizationTendency: number;
  readonly genotypeLabel: string;
  readonly tendencyBasis: string;
}

const CANVAS_W = 660;
const CANVAS_H = 220;
/** Ticks to fast-forward when the viewer prefers reduced motion. */
const SETTLE_TICKS = 180;

/**
 * Live cell canvas, driven by the real `lib/cellsim` (SPEC §4.4, §5).
 *
 * The slider sets pO2 and the runner is re-keyed on it, so each slider
 * position starts a fresh deterministic run from the fixture seed: the same
 * position always produces the same numbers.
 */
export function CellCanvas({
  simulation,
  polymerizationTendency,
  genotypeLabel,
  tendencyBasis,
}: CellCanvasProps) {
  const [pO2, setPO2] = useState(simulation.defaultPO2);
  const [running, setRunning] = useState(true);
  const [generation, setGeneration] = useState(0);

  const params: CellSimParams = useMemo(
    () => ({
      seed: simulation.seed,
      cellCount: simulation.cellCount,
      pO2,
      capillaryConstriction: simulation.capillaryConstriction,
      polymerizationTendency,
    }),
    [
      simulation.seed,
      simulation.cellCount,
      simulation.capillaryConstriction,
      pO2,
      polymerizationTendency,
    ],
  );

  const below = pO2 < simulation.sicklingOnsetBelow;

  return (
    <section className="flex flex-col gap-3" aria-label="Live cell simulation">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Waves className="size-4 text-primary" aria-hidden="true" />
          Capillary flow
        </h3>
        <p className="truncate text-[11.5px] text-muted-foreground">
          {genotypeLabel} · tendency {polymerizationTendency.toFixed(2)}
        </p>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setRunning((r) => !r)}
            aria-label={running ? 'Pause the simulation' : 'Run the simulation'}
          >
            {running ? <Pause /> : <Play />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setGeneration((g) => g + 1)}
            aria-label="Restart the simulation from its seed"
          >
            <RotateCcw />
          </Button>
        </div>
      </header>

      {/* Re-keying restarts the run from the seed whenever the inputs change,
          so no effect has to reach in and reset it. */}
      <SimRunner
        key={`${params.pO2}:${params.polymerizationTendency}:${generation}`}
        params={params}
        running={running}
        simulation={simulation}
        genotypeLabel={genotypeLabel}
      />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="po2" className="text-[11.5px] font-medium">
            {simulation.pO2Label}
          </Label>
          <span className="font-mono text-[11.5px] tnum">
            {pO2} {simulation.pO2Unit}
            {below && (
              <span className="ml-1.5 text-escalate">
                below onset ({simulation.sicklingOnsetBelow})
              </span>
            )}
          </span>
        </div>
        <Slider
          id="po2"
          min={simulation.pO2Min}
          max={simulation.pO2Max}
          step={1}
          value={[pO2]}
          onValueChange={(value) => {
            const next = Array.isArray(value) ? value[0] : value;
            if (typeof next === 'number') setPO2(next);
          }}
          aria-label={`${simulation.pO2Label} in ${simulation.pO2Unit}`}
          aria-valuetext={`${pO2} ${simulation.pO2Unit}`}
        />
      </div>

      <p className="flex items-start gap-1.5 rounded-lg border border-dashed px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <Activity className="mt-px size-3 shrink-0" aria-hidden="true" />
        <span>
          <strong className="font-semibold text-foreground">Illustrative model.</strong>{' '}
          {simulation.note} Seed {simulation.seed}, {simulation.cellCount} cells.{' '}
          {tendencyBasis}
        </span>
      </p>
    </section>
  );
}

/**
 * Owns one run. Mounted fresh per parameter set, so its initial state is the
 * seeded simulation and nothing needs to reset it after the fact.
 */
function SimRunner({
  params,
  running,
  simulation,
  genotypeLabel,
}: {
  readonly params: CellSimParams;
  readonly running: boolean;
  readonly simulation: SimulationView;
  readonly genotypeLabel: string;
}) {
  const [state, setState] = useState<SimState>(() => createSim(params));
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── Step loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!running) return;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let handle = 0;
    if (reduceMotion) {
      // Fast-forward to a representative steady state in one frame rather
      // than animating. Deferred to a frame so it is not a synchronous
      // setState in the effect body.
      handle = requestAnimationFrame(() => {
        setState((previous) => {
          let settled = previous;
          for (let i = 0; i < SETTLE_TICKS; i += 1) settled = step(settled);
          return settled;
        });
      });
      return () => cancelAnimationFrame(handle);
    }

    let active = true;
    const tick = () => {
      if (!active) return;
      setState((previous) => step(previous));
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(handle);
    };
  }, [running]);

  // ── Paint ───────────────────────────────────────────────────────────────
  const paint = useCallback(
    (canvas: HTMLCanvasElement, current: SimState) => {
      const ctx = canvas.getContext('2d');
      if (ctx === null) return;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(CANVAS_W * dpr)) {
        canvas.width = Math.round(CANVAS_W * dpr);
        canvas.height = Math.round(CANVAS_H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      const styles = getComputedStyle(canvas);
      const read = (name: string, fallback: string): string => {
        const value = styles.getPropertyValue(name).trim();
        return value === '' ? fallback : value;
      };
      const wall = read('--border', '#d4d4d8');
      const discoid = read('--primary', '#4f6bd8');
      const sickled = read('--verdict-block', '#c0392b');
      const plasma = read('--muted', '#f4f4f5');

      // Capillary walls, from the same function the physics uses.
      ctx.beginPath();
      for (let px = 0; px <= CANVAS_W; px += 4) {
        const half = channelHalfHeight(px / CANVAS_W, current.params.capillaryConstriction);
        const y = (0.5 - half) * CANVAS_H;
        if (px === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      for (let px = CANVAS_W; px >= 0; px -= 4) {
        const half = channelHalfHeight(px / CANVAS_W, current.params.capillaryConstriction);
        ctx.lineTo(px, (0.5 + half) * CANVAS_H);
      }
      ctx.closePath();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = plasma;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = wall;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      for (const cell of current.cells) {
        ctx.save();
        ctx.translate(cell.x * CANVAS_W, cell.y * CANVAS_H);
        ctx.rotate(cell.orientation);
        if (cell.state === 'sickled') {
          // A crescent, so shape alone distinguishes the two states.
          ctx.beginPath();
          ctx.arc(0, 0, 5.4, Math.PI * 0.32, Math.PI * 1.68);
          ctx.arc(3.6, 0, 5.2, Math.PI * 1.52, Math.PI * 0.48, true);
          ctx.closePath();
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = sickled;
        } else {
          ctx.beginPath();
          ctx.ellipse(0, 0, 4.6, 3.4, 0, 0, Math.PI * 2);
          ctx.globalAlpha = 0.78;
          ctx.fillStyle = discoid;
        }
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas !== null) paint(canvas, state);
  }, [paint, state]);

  const metrics = state.metrics;

  return (
    <>
      <div className="overflow-hidden rounded-xl border bg-card/60">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 'auto', aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
          role="img"
          aria-label={`Capillary flow for ${genotypeLabel} at ${params.pO2} ${
            simulation.pO2Unit
          }. ${(metrics.sickledFraction * 100).toFixed(0)}% of ${
            simulation.cellCount
          } cells are sickled, occlusion is ${(metrics.occlusion * 100).toFixed(
            0,
          )}%, and mean flow is ${metrics.meanFlow.toFixed(4)} normalised units per tick.`}
        />
      </div>

      <dl className="grid grid-cols-3 gap-2" aria-live="off">
        <Metric
          label="Occlusion"
          value={`${(metrics.occlusion * 100).toFixed(0)}%`}
          tone={metrics.occlusion > 0.4 ? 'bad' : 'ok'}
        />
        <Metric
          label="Sickled"
          value={`${(metrics.sickledFraction * 100).toFixed(0)}%`}
          tone={metrics.sickledFraction > 0.2 ? 'bad' : 'ok'}
        />
        <Metric label="Mean flow" value={metrics.meanFlow.toFixed(4)} tone="neutral" />
      </dl>
      <p className="font-mono text-[10.5px] text-muted-foreground tnum">tick {state.tick}</p>
    </>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone: 'ok' | 'bad' | 'neutral';
}) {
  const color = tone === 'bad' ? 'text-block' : tone === 'ok' ? 'text-pass' : 'text-foreground';
  return (
    <div className="rounded-lg border bg-card/60 px-2.5 py-2">
      <dt className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className={`mt-0.5 font-mono text-[15px] font-semibold tnum ${color}`}>{value}</dd>
    </div>
  );
}
