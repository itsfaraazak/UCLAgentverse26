'use client';

/**
 * The hero: a live capillary rendered from real `lib/cellsim` state.
 *
 * `requestAnimationFrame` drives actual `step()` calls — nothing here is a CSS
 * keyframe pretending to be motion. The loop and the observers are torn down
 * on unmount.
 */

import { useCallback, useEffect, useRef } from 'react';
import { CellSim, lumenHalfWidth, type SimMetrics } from '@/lib/cellsim';

export interface CellCanvasProps {
  seed: number;
  cellCount: number;
  pO2: number;
  polymerizationTendency: number;
  capillaryConstriction: number;
  /** Re-seeds the population when it changes (e.g. a new filmstrip frame). */
  generation: string;
  running: boolean;
  onMetrics: (metrics: SimMetrics, tick: number) => void;
}

const WALL_SAMPLES = 160;

function cssVar(el: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

export function CellCanvas({
  seed,
  cellCount,
  pO2,
  polymerizationTendency,
  capillaryConstriction,
  generation,
  running,
  onMetrics,
}: CellCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<CellSim | null>(null);
  const frameRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const onMetricsRef = useRef(onMetrics);
  const pO2Ref = useRef(pO2);
  const runningRef = useRef(running);

  useEffect(() => {
    onMetricsRef.current = onMetrics;
  }, [onMetrics]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  // pO2 changes must not restart the population: the whole point of the
  // control is watching the same cells respond.
  useEffect(() => {
    pO2Ref.current = pO2;
    simRef.current?.setPO2(pO2);
  }, [pO2]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const sim = simRef.current;
    if (canvas === null || sim === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const { w, h, dpr } = sizeRef.current;
    if (w === 0 || h === 0) return;

    const state = sim.state();
    const styleHost = canvas.parentElement ?? canvas;
    const lumen = cssVar(styleHost, '--lumen', '#223');
    const wall = cssVar(styleHost, '--bezel-edge', '#556');
    const grid = cssVar(styleHost, '--grid-line', 'rgba(255,255,255,0.08)');
    const discoid = cssVar(styleHost, '--cell-discoid', '#d4553c');
    const sickled = cssVar(styleHost, '--cell-sickled', '#9a6ad8');
    const trace = cssVar(styleHost, '--trace', '#5fd');

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const yAt = (v: number) => v * h;
    const xAt = (v: number) => v * w;

    // Lumen: a vessel whose walls pinch in at the constriction.
    ctx.beginPath();
    for (let i = 0; i <= WALL_SAMPLES; i += 1) {
      const t = i / WALL_SAMPLES;
      const hw = lumenHalfWidth(t, capillaryConstriction);
      const y = yAt(0.5 - hw);
      if (i === 0) ctx.moveTo(xAt(t), y);
      else ctx.lineTo(xAt(t), y);
    }
    for (let i = WALL_SAMPLES; i >= 0; i -= 1) {
      const t = i / WALL_SAMPLES;
      const hw = lumenHalfWidth(t, capillaryConstriction);
      ctx.lineTo(xAt(t), yAt(0.5 + hw));
    }
    ctx.closePath();
    ctx.fillStyle = lumen;
    ctx.fill();

    // Engraved measurement grid, clipped to the lumen.
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let i = 1; i < 20; i += 1) {
      const x = Math.round(xAt(i / 20)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, Math.round(yAt(0.5)) + 0.5);
    ctx.lineTo(w, Math.round(yAt(0.5)) + 0.5);
    ctx.stroke();
    ctx.restore();

    // Wall hairlines.
    ctx.strokeStyle = wall;
    ctx.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let i = 0; i <= WALL_SAMPLES; i += 1) {
        const t = i / WALL_SAMPLES;
        const hw = lumenHalfWidth(t, capillaryConstriction);
        const y = yAt(0.5 + side * hw);
        if (i === 0) ctx.moveTo(xAt(t), y);
        else ctx.lineTo(xAt(t), y);
      }
      ctx.stroke();
    }

    // Cells. A sickled cell is drawn elongated and tilted; a discoid cell is
    // a disc with a pale centre, the way one looks down a microscope.
    const scale = Math.min(w, h);
    for (const cell of state.cells) {
      const cx = xAt(cell.x);
      const cy = yAt(cell.y);
      const r = cell.radius * scale;

      if (cell.vx > 0) {
        ctx.strokeStyle = trace;
        ctx.globalAlpha = Math.min(0.35, cell.vx * 40);
        ctx.lineWidth = Math.max(1, r * 0.35);
        ctx.beginPath();
        ctx.moveTo(cx - Math.min(60, cell.vx * 9000), cy);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.save();
      ctx.translate(cx, cy);
      if (cell.state === 'sickled') {
        ctx.rotate(((cell.id % 7) - 3) * 0.18);
        ctx.fillStyle = sickled;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.9, r * 0.52, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = discoid;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }, [capillaryConstriction]);

  // Build / rebuild the simulation when the genotype or fixture changes.
  useEffect(() => {
    simRef.current = new CellSim({
      seed,
      cellCount,
      pO2: pO2Ref.current,
      polymerizationTendency,
      capillaryConstriction,
    });
    // Settle the population into the channel before the first paint.
    simRef.current.run(120);
    draw();
    const settled = simRef.current.state();
    onMetricsRef.current(
      {
        occlusion: settled.occlusion,
        meanFlow: settled.meanFlow,
        sickledFraction: settled.sickledFraction,
      },
      settled.tick,
    );
  }, [seed, cellCount, polymerizationTendency, capillaryConstriction, generation, draw]);

  // Size the backing store to the element and the device pixel ratio.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const host = canvas.parentElement;
    if (host === null) return;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      draw();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => observer.disconnect();
  }, [draw]);

  // The animation loop: real steps, real metrics, cleaned up on unmount.
  useEffect(() => {
    let lastReport = 0;

    const tick = (time: number) => {
      const sim = simRef.current;
      if (sim !== null && runningRef.current) {
        sim.step();
        draw();
        if (time - lastReport > 180) {
          lastReport = time;
          const state = sim.state();
          onMetricsRef.current(
            {
              occlusion: state.occlusion,
              meanFlow: state.meanFlow,
              sickledFraction: state.sickledFraction,
            },
            state.tick,
          );
        }
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [draw]);

  return <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />;
}
