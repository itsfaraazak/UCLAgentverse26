'use client';

/**
 * The hero: a live capillary rendered from real `lib/cellsim` snapshots.
 *
 * `requestAnimationFrame` drives actual `step()` calls — nothing here is a
 * CSS keyframe pretending to be motion. The loop and the observers are torn
 * down on unmount, and the loop is not scheduled at all while paused or when
 * the viewer has asked for reduced motion.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { CellSim, channelHalfHeight, type SimMetrics, type SimSnapshot } from '@/lib/cellsim';

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

const WALL_SAMPLES = 180;
const SETTLE_STEPS = 90;
const REPORT_INTERVAL_MS = 180;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function readReducedMotionOnServer(): boolean {
  return false;
}

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
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    readReducedMotion,
    readReducedMotionOnServer,
  );

  useEffect(() => {
    onMetricsRef.current = onMetrics;
  }, [onMetrics]);

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

    const snapshot: SimSnapshot = sim.snapshot();
    const geom = snapshot.geom;
    const host = canvas.parentElement ?? canvas;
    const lumen = cssVar(host, '--lumen', '#223');
    const wall = cssVar(host, '--bezel-edge', '#556');
    const grid = cssVar(host, '--grid-line', 'rgba(255,255,255,0.08)');
    const discoid = cssVar(host, '--cell-discoid', '#d4553c');
    const sickled = cssVar(host, '--cell-sickled', '#9a6ad8');
    const trace = cssVar(host, '--trace', '#5fd');

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Simulation space is `geom.width` × `geom.height`; the canvas stretches
    // it to fill, so one scale per axis.
    const sx = w / geom.width;
    const sy = h / geom.height;
    const rScale = Math.min(sx, sy);
    const xAt = (x: number) => x * sx;
    const yAt = (y: number) => y * sy;

    ctx.beginPath();
    for (let i = 0; i <= WALL_SAMPLES; i += 1) {
      const x = (i / WALL_SAMPLES) * geom.width;
      const half = channelHalfHeight(x, geom.opening, geom.height);
      const y = yAt(geom.height / 2 - half);
      if (i === 0) ctx.moveTo(xAt(x), y);
      else ctx.lineTo(xAt(x), y);
    }
    for (let i = WALL_SAMPLES; i >= 0; i -= 1) {
      const x = (i / WALL_SAMPLES) * geom.width;
      const half = channelHalfHeight(x, geom.opening, geom.height);
      ctx.lineTo(xAt(x), yAt(geom.height / 2 + half));
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
      const x = Math.round(xAt((i / 20) * geom.width)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, Math.round(yAt(geom.height / 2)) + 0.5);
    ctx.lineTo(w, Math.round(yAt(geom.height / 2)) + 0.5);
    ctx.stroke();
    ctx.restore();

    // Wall hairlines.
    ctx.strokeStyle = wall;
    ctx.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let i = 0; i <= WALL_SAMPLES; i += 1) {
        const x = (i / WALL_SAMPLES) * geom.width;
        const half = channelHalfHeight(x, geom.opening, geom.height);
        const y = yAt(geom.height / 2 + side * half);
        if (i === 0) ctx.moveTo(xAt(x), y);
        else ctx.lineTo(xAt(x), y);
      }
      ctx.stroke();
    }

    // Cells. A sickled cell is drawn elongated along its own heading; a
    // discoid cell is a disc with a pale centre, as down a microscope.
    for (const cell of snapshot.cells) {
      const cx = xAt(cell.x);
      const cy = yAt(cell.y);
      const r = cell.radius * rScale;

      if (cell.vx > 0.05) {
        ctx.strokeStyle = trace;
        ctx.globalAlpha = Math.min(0.32, cell.vx * 0.09);
        ctx.lineWidth = Math.max(1, r * 0.3);
        ctx.beginPath();
        ctx.moveTo(cx - Math.min(48, cell.vx * sx * 6), cy);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.save();
      ctx.translate(cx, cy);
      if (cell.state === 'sickled') {
        ctx.rotate(cell.theta);
        ctx.fillStyle = sickled;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.75, r * 0.5, 0, 0, Math.PI * 2);
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
  }, []);

  const report = useCallback((snapshot: SimSnapshot) => {
    onMetricsRef.current(snapshot.metrics, snapshot.tick);
  }, []);

  // Build / rebuild the simulation when the genotype or fixture changes.
  useEffect(() => {
    const sim = new CellSim({
      seed,
      cellCount,
      pO2: pO2Ref.current,
      polymerizationTendency,
      capillaryConstriction,
    });
    simRef.current = sim;
    // Settle the population into the channel before the first paint.
    const settled = sim.run(SETTLE_STEPS);
    draw();
    report(settled);
  }, [seed, cellCount, polymerizationTendency, capillaryConstriction, generation, draw, report]);

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

  // The animation loop: real steps, real metrics, and no frames scheduled
  // while paused or when reduced motion is requested.
  useEffect(() => {
    if (!running || reducedMotion) return;
    let lastReport = 0;

    const tick = (time: number) => {
      const sim = simRef.current;
      if (sim !== null) {
        const snapshot = sim.step();
        draw();
        if (time - lastReport > REPORT_INTERVAL_MS) {
          lastReport = time;
          report(snapshot);
        }
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [running, reducedMotion, draw, report]);

  // With reduced motion the simulation still advances on demand, in one
  // deliberate jump per oxygen-tension change, rather than continuously.
  useEffect(() => {
    if (!reducedMotion) return;
    const sim = simRef.current;
    if (sim === null) return;
    const snapshot = sim.run(60);
    draw();
    report(snapshot);
  }, [reducedMotion, pO2, draw, report]);

  return <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />;
}
