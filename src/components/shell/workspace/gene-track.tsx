"use client";

import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "cn";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from "react";

import type { EditView, ExonView, LocusView } from "@/components/shell/model/types";

export interface GeneTrackProps {
  readonly locus: LocusView;
  /** The edit under review, or null when viewing the reference line. */
  readonly edit: EditView | null;
  /** Additional codon positions to tick, e.g. every changed alignment row. */
  readonly marks?: readonly number[];
  readonly className?: string;
}

/* ── Geometry ────────────────────────────────────────────────────────────
   The viewBox width tracks the measured container width, so one SVG unit is
   one CSS pixel and every font-size below is a real pixel size. */

const FALLBACK_WIDTH = 720;
const MIN_WIDTH = 240;
const HEIGHT = 152;
const PAD_X = 12;

const Y = {
  callout: 13,
  headTop: 18,
  headBottom: 26,
  cdsLabel: 37,
  cdsBracket: 43,
  cdsCap: 49,
  marksTop: 55,
  marksBottom: 62,
  exonTop: 66,
  exonBottom: 80,
  exonLabel: 94,
  basesTop: 101,
  basesBottom: 122,
  basesText: 116,
  axis: 130,
  axisTick: 134,
  axisLabel: 146,
} as const;

/** Narrowest window, in codons. Deep enough for full-size base letters. */
const MIN_SPAN = 9;
/** Half-width of the "Edit site" window, in codons either side of the edit. */
const EDIT_RADIUS = 6;
/** Per-codon width at which the three bases of each codon are drawn. */
const BASES_MIN_PX = 20;
/** Per-codon width at which the translated residue of each codon is drawn. */
const RESIDUE_MIN_PX = 11;
const AXIS_LABEL_MIN_GAP = 44;
const LABEL_GAP = 6;
const SLIDER_STEPS = 1000;
const ZOOM_DURATION_MS = 220;

/** Conservative advance widths, used only to decide whether a label fits. */
const SANS_CHAR_PX = 6.4;
const MONO_CHAR_PX = 7.2;
const AXIS_CHAR_PX = 6;

interface View {
  readonly start: number;
  readonly span: number;
}

interface Domain {
  /** First codon coordinate (codon c occupies [c, c + 1)). */
  readonly lo: number;
  readonly hi: number;
  readonly lastCodon: number;
  readonly extent: number;
  readonly minSpan: number;
}

interface Interval {
  readonly x0: number;
  readonly x1: number;
}

type Preset = "locus" | "modelled" | "edit";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampView(view: View, domain: Domain): View {
  const span = clamp(
    Number.isFinite(view.span) ? view.span : domain.extent,
    domain.minSpan,
    domain.extent,
  );
  const start = clamp(
    Number.isFinite(view.start) ? view.start : domain.lo,
    domain.lo,
    domain.hi - span,
  );
  return { start, span };
}

function domainOf(locus: LocusView): Domain {
  const modelledEnd = locus.startCodon + locus.codonCount - 1;
  const lastCodon = locus.exons.reduce(
    (max, exon) => Math.max(max, exon.codonEnd),
    Math.max(1, modelledEnd),
  );
  const lo = 1;
  const hi = lastCodon + 1;
  const extent = hi - lo;
  return { lo, hi, lastCodon, extent, minSpan: Math.min(extent, MIN_SPAN) };
}

function presetView(preset: Preset, locus: LocusView, edit: EditView | null, domain: Domain): View | null {
  switch (preset) {
    case "locus":
      return clampView({ start: domain.lo, span: domain.extent }, domain);
    case "modelled":
      return clampView({ start: locus.startCodon - 1, span: locus.codonCount + 2 }, domain);
    case "edit": {
      if (edit === null) return null;
      const span = EDIT_RADIUS * 2 + 1;
      return clampView({ start: edit.codonIndex + 0.5 - span / 2, span }, domain);
    }
  }
}

function sameView(a: View, b: View): boolean {
  return Math.abs(a.start - b.start) < 0.01 && Math.abs(a.span - b.span) < 0.01;
}

function spanToSlider(span: number, domain: Domain): number {
  if (domain.extent <= domain.minSpan) return 0;
  const ratio = Math.log(span / domain.extent) / Math.log(domain.minSpan / domain.extent);
  return Math.round(clamp(ratio, 0, 1) * SLIDER_STEPS);
}

function sliderToSpan(value: number, domain: Domain): number {
  if (domain.extent <= domain.minSpan) return domain.extent;
  return domain.extent * Math.pow(domain.minSpan / domain.extent, value / SLIDER_STEPS);
}

function zoomAround(view: View, factor: number, anchor: number, domain: Domain): View {
  const span = clamp(view.span * factor, domain.minSpan, domain.extent);
  const ratio = (anchor - view.start) / view.span;
  return clampView({ start: anchor - ratio * span, span }, domain);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.x0 < b.x1 + LABEL_GAP && b.x0 < a.x1 + LABEL_GAP;
}

/**
 * Returns the centre x for a label of `width`, kept inside `bounds` and clear
 * of `occupied`, or null when it cannot fit — the caller then drops it.
 */
function placeLabel(
  center: number,
  width: number,
  bounds: Interval,
  occupied: readonly Interval[],
): number | null {
  const min = bounds.x0 + width / 2;
  const max = bounds.x1 - width / 2;
  if (min > max) return null;
  const fits = (c: number): boolean => {
    const box = { x0: c - width / 2, x1: c + width / 2 };
    return occupied.every((o) => !overlaps(box, o));
  };
  const candidates = [clamp(center, min, max)];
  for (const o of occupied) {
    candidates.push(o.x0 - LABEL_GAP - width / 2, o.x1 + LABEL_GAP + width / 2);
  }
  let best: number | null = null;
  for (const c of candidates) {
    if (c < min || c > max || !fits(c)) continue;
    if (best === null || Math.abs(c - center) < Math.abs(best - center)) best = c;
  }
  return best;
}

function niceStep(pxPerCodon: number): number {
  for (let magnitude = 1; magnitude < 1e7; magnitude *= 10) {
    for (const m of [1, 2, 5]) {
      const step = m * magnitude;
      if (step * pxPerCodon >= AXIS_LABEL_MIN_GAP) return step;
    }
  }
  return 1e7;
}

function codonBases(locus: LocusView, codon: number): string | null {
  const offset = codon - locus.startCodon;
  if (offset < 0 || offset >= locus.codonCount) return null;
  const bases = locus.reference.bases.slice(offset * 3, offset * 3 + 3);
  return bases.length === 3 ? bases : null;
}

function codonResidue(locus: LocusView, codon: number): string | null {
  const offset = codon - locus.startCodon;
  if (offset < 0 || offset >= locus.codonCount) return null;
  const residue = locus.reference.protein.charAt(offset);
  return residue === "" ? null : residue;
}

/** A gap in an indel is rendered as the alignment gap character. */
function codonText(codon: string): string {
  return codon === "" ? "-" : codon;
}

interface ExonPiece {
  readonly key: string;
  readonly from: number;
  readonly to: number;
  readonly modelled: boolean;
}

/**
 * Splits an exon into the part inside the modelled CDS window (drawn solid)
 * and the parts outside it (drawn as hatched context). An exon flagged
 * `modelled` can still extend well past the window — HBB exon 2 is modelled
 * on its first codon only.
 */
function exonPieces(exon: ExonView, modelStart: number, modelEnd: number): ExonPiece[] {
  const from = exon.codonStart;
  const to = exon.codonEnd + 1;
  if (!exon.modelled) return [{ key: "ctx", from, to, modelled: false }];
  const inFrom = Math.max(from, modelStart);
  const inTo = Math.min(to, modelEnd + 1);
  if (inFrom >= inTo) return [{ key: "ctx", from, to, modelled: false }];
  const pieces: ExonPiece[] = [];
  if (from < inFrom) pieces.push({ key: "pre", from, to: inFrom, modelled: false });
  pieces.push({ key: "in", from: inFrom, to: inTo, modelled: true });
  if (inTo < to) pieces.push({ key: "post", from: inTo, to, modelled: false });
  return pieces;
}

export function GeneTrack({ locus, edit, marks, className }: GeneTrackProps): ReactElement {
  const domain = domainOf(locus);
  const modelStart = locus.startCodon;
  const modelEnd = locus.startCodon + locus.codonCount - 1;
  const modelledNt = locus.codonCount * 3;

  const [rawView, setRawView] = useState<View>({ start: domain.lo, span: domain.extent });
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [dragging, setDragging] = useState(false);
  const view = clampView(rawView, domain);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>(view);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; clientX: number; start: number } | null>(null);

  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const hatchId = `${uid}-hatch`;
  const clipId = `${uid}-clip`;

  useEffect(() => {
    const node = containerRef.current;
    if (node === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      setWidth(Math.max(MIN_WIDTH, Math.round(entry.contentRect.width)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const currentView = (): View => clampView(viewRef.current, domain);

  const commit = (next: View): void => {
    const clamped = clampView(next, domain);
    viewRef.current = clamped;
    setRawView(clamped);
  };

  const stopAnimation = (): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const jump = (next: View): void => {
    stopAnimation();
    commit(next);
  };

  const animateTo = (target: View): void => {
    stopAnimation();
    const from = currentView();
    if (prefersReducedMotion()) {
      commit(target);
      return;
    }
    let t0: number | null = null;
    const fromLog = Math.log(from.span);
    const toLog = Math.log(target.span);
    const tick = (now: number): void => {
      t0 ??= now;
      const t = clamp((now - t0) / ZOOM_DURATION_MS, 0, 1);
      const k = 1 - Math.pow(1 - t, 3);
      commit({
        start: from.start + (target.start - from.start) * k,
        span: Math.exp(fromLog + (toLog - fromLog) * k),
      });
      rafRef.current = t < 1 ? requestAnimationFrame(tick) : null;
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const zoomBy = (factor: number, animate: boolean): void => {
    const v = currentView();
    const next = zoomAround(v, factor, v.start + v.span / 2, domain);
    if (animate) animateTo(next);
    else jump(next);
  };

  const panBy = (codons: number): void => {
    const v = currentView();
    jump({ start: v.start + codons, span: v.span });
  };

  /* ── Derived layout ── */

  const innerW = Math.max(1, width - PAD_X * 2);
  const plotLeft = PAD_X;
  const plotRight = PAD_X + innerW;
  const pxPerCodon = innerW / view.span;
  const x = (codon: number): number => plotLeft + ((codon - view.start) / view.span) * innerW;

  const firstVisible = Math.max(domain.lo, Math.floor(view.start));
  const lastVisible = Math.min(domain.lastCodon, Math.ceil(view.start + view.span) - 1);
  const inView = (codon: number): boolean => codon >= firstVisible && codon <= lastVisible;

  const sequenceMode: "bases" | "residues" | "none" =
    pxPerCodon >= BASES_MIN_PX ? "bases" : pxPerCodon >= RESIDUE_MIN_PX ? "residues" : "none";

  const editCodon = edit?.codonIndex ?? null;
  const editX = editCodon !== null && inView(editCodon) ? x(editCodon + 0.5) : null;
  const editObstacle: Interval[] = editX === null ? [] : [{ x0: editX - 4, x1: editX + 4 }];

  // Axis ticks: a "nice" interval for the zoom, then greedy label de-collision.
  const step = niceStep(pxPerCodon);
  const tickCodons: number[] = [];
  if (inView(1)) tickCodons.push(1);
  for (let c = Math.max(step, Math.ceil(firstVisible / step) * step); c <= lastVisible; c += step) {
    if (c !== 1) tickCodons.push(c);
  }
  const axisTicks: { codon: number; x: number; label: boolean }[] = [];
  const axisOccupied: Interval[] = [];
  for (const codon of tickCodons) {
    const cx = x(codon + 0.5);
    const w = String(codon).length * AXIS_CHAR_PX;
    const box = { x0: cx - w / 2, x1: cx + w / 2 };
    const fits = box.x0 >= plotLeft - PAD_X && box.x1 <= plotRight + PAD_X && axisOccupied.every((o) => !overlaps(box, o));
    if (fits) axisOccupied.push(box);
    axisTicks.push({ codon, x: cx, label: fits });
  }

  // Modelled CDS bracket and its label.
  const cdsX0 = x(modelStart);
  const cdsX1 = x(modelEnd + 1);
  const cdsVisible: Interval = { x0: Math.max(cdsX0, plotLeft), x1: Math.min(cdsX1, plotRight) };
  const cdsOnScreen = cdsVisible.x1 > cdsVisible.x0;
  const cdsLabels = [
    `Modelled CDS · codons ${modelStart}–${modelEnd} · ${modelledNt} nt`,
    `Modelled · ${modelledNt} nt`,
    `${modelledNt} nt`,
  ];
  let cdsLabel: { text: string; x: number } | null = null;
  if (cdsOnScreen) {
    for (const text of cdsLabels) {
      const w = text.length * SANS_CHAR_PX;
      const cx = placeLabel((cdsVisible.x0 + cdsVisible.x1) / 2, w, cdsVisible, editObstacle);
      if (cx !== null) {
        cdsLabel = { text, x: cx };
        break;
      }
    }
  }

  // Exon labels, placed under the visible part of each exon.
  const exonLabelOccupied: Interval[] = [...editObstacle];
  const exonLabels: { key: number; text: string; x: number }[] = [];
  for (const exon of locus.exons) {
    const visible: Interval = {
      x0: Math.max(x(exon.codonStart), plotLeft),
      x1: Math.min(x(exon.codonEnd + 1), plotRight),
    };
    if (visible.x1 <= visible.x0) continue;
    const w = exon.label.length * SANS_CHAR_PX;
    const cx = placeLabel((visible.x0 + visible.x1) / 2, w, visible, exonLabelOccupied);
    if (cx === null) continue;
    exonLabelOccupied.push({ x0: cx - w / 2, x1: cx + w / 2 });
    exonLabels.push({ key: exon.index, text: exon.label, x: cx });
  }

  // Secondary marks: whole codons in view, de-duplicated, never on the edit.
  const markCodons = Array.from(new Set(marks ?? []))
    .filter((c) => Number.isInteger(c) && inView(c) && c !== editCodon)
    .sort((a, b) => a - b);

  // Edit callout: to the right of the marker, flipped left when it would clip.
  let callout: { x: number; anchor: "start" | "end"; withLabel: boolean } | null = null;
  if (edit !== null && editX !== null) {
    const base =
      `Codon ${edit.codonIndex}`.length * SANS_CHAR_PX +
      (codonText(edit.refCodon).length + codonText(edit.altCodon).length + 1) * MONO_CHAR_PX +
      12 +
      (edit.refAa !== null && edit.altAa !== null ? 3 * MONO_CHAR_PX + 12 : 0);
    const withLabelW = base + 12 + edit.label.length * SANS_CHAR_PX;
    const withLabel = withLabelW <= innerW - 16;
    const w = withLabel ? withLabelW : base;
    if (editX + 8 + w <= plotRight + PAD_X) callout = { x: editX + 8, anchor: "start", withLabel };
    else if (editX - 8 - w >= plotLeft - PAD_X) callout = { x: editX - 8, anchor: "end", withLabel };
    else callout = { x: plotLeft, anchor: "start", withLabel: false };
  }
  const editOffscreen: "left" | "right" | null =
    editCodon === null || editX !== null ? null : editCodon < firstVisible ? "left" : "right";

  // Codon-level sequence band.
  const sequenceCodons: number[] = [];
  if (sequenceMode !== "none") {
    for (let c = Math.max(firstVisible, modelStart); c <= Math.min(lastVisible, modelEnd); c++) {
      sequenceCodons.push(c);
    }
  }
  const baseFont = clamp(pxPerCodon / 3 / 0.64, 9, 13);
  const notModelledSpans: Interval[] = [];
  if (sequenceMode !== "none") {
    const leftEnd = Math.min(x(modelStart), plotRight);
    if (leftEnd - plotLeft > 0) notModelledSpans.push({ x0: plotLeft, x1: leftEnd });
    const rightStart = Math.max(x(modelEnd + 1), plotLeft);
    if (plotRight - rightStart > 0) notModelledSpans.push({ x0: rightStart, x1: plotRight });
  }
  const changedPositions =
    edit !== null && edit.refCodon.length === 3 && edit.altCodon.length === 3
      ? [0, 1, 2].filter((k) => edit.refCodon.charAt(k) !== edit.altCodon.charAt(k))
      : [];

  /* ── Zoom chrome state ── */

  const presets: { id: Preset; label: string; target: View | null }[] = [
    { id: "locus", label: "Locus", target: presetView("locus", locus, edit, domain) },
    { id: "modelled", label: "Modelled region", target: presetView("modelled", locus, edit, domain) },
    { id: "edit", label: "Edit site", target: presetView("edit", locus, edit, domain) },
  ];
  const sliderValue = spanToSlider(view.span, domain);
  const zoomLocked = domain.extent <= domain.minSpan;
  const atStart = view.start <= domain.lo + 1e-6;
  const atEnd = view.start + view.span >= domain.hi - 1e-6;
  const windowText = `Showing codons ${firstVisible}–${lastVisible} of ${domain.lastCodon}`;

  /* ── Text equivalents ── */

  const modelledExonCount = locus.exons.filter((e) => e.modelled).length;
  const exonSentence = `${locus.exons.length} exon${locus.exons.length === 1 ? "" : "s"} spanning codons 1–${domain.lastCodon}${
    locus.exons.length > 0
      ? ` (${locus.exons.map((e) => `${e.label}: codons ${e.codonStart}–${e.codonEnd}`).join("; ")})`
      : ""
  }`;
  const modelledSentence = `Modelled CDS window: codons ${modelStart}–${modelEnd}, ${modelledNt} nt (${locus.reference.label})`;
  const editSentence =
    edit === null
      ? "No edit: viewing the reference line"
      : `Edit at codon ${edit.codonIndex}: ${codonText(edit.refCodon)} to ${codonText(edit.altCodon)}${
          edit.refAa !== null && edit.altAa !== null ? `, ${edit.refAa} to ${edit.altAa}` : ""
        }${edit.proteinHgvs !== null ? ` (${edit.proteinHgvs})` : ""}`;
  const descText = [
    `${locus.gene}, ${locus.name}, chromosome ${locus.chromosome}.`,
    `${exonSentence}.`,
    `${modelledSentence}; only this region can be diffed and translated, the rest is shown as context.`,
    `${editSentence}.`,
    markCodons.length > 0 ? `Also marked: codon${markCodons.length === 1 ? "" : "s"} ${markCodons.join(", ")}.` : "",
    `${windowText}.`,
  ]
    .filter((s) => s !== "")
    .join(" ");

  /* ── Event handlers ── */

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const v = currentView();
    const stepCodons = event.shiftKey ? v.span / 2 : Math.max(1, Math.round(v.span / 8));
    switch (event.key) {
      case "ArrowLeft":
        panBy(-stepCodons);
        break;
      case "ArrowRight":
        panBy(stepCodons);
        break;
      case "+":
      case "=":
      case "ArrowUp":
        zoomBy(0.5, false);
        break;
      case "-":
      case "_":
      case "ArrowDown":
        zoomBy(2, false);
        break;
      case "Home":
        jump({ start: domain.lo, span: v.span });
        break;
      case "End":
        jump({ start: domain.hi - v.span, span: v.span });
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    stopAnimation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, start: currentView().start };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const unitsPerPx = rect.width > 0 ? width / rect.width : 1;
    const v = currentView();
    const codons = ((event.clientX - drag.clientX) * unitsPerPx) / (innerW / v.span);
    commit({ start: drag.start - codons, span: v.span });
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const chromeButton =
    "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

  return (
    <section className={cn("flex flex-col gap-3", className)} aria-label={`${locus.gene} gene track`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="Zoom preset" className="hairline inline-flex items-center gap-0.5 rounded-lg border p-0.5">
          {presets.map((preset) => {
            const active = preset.target !== null && sameView(view, preset.target);
            return (
              <button
                key={preset.id}
                type="button"
                className={cn(chromeButton, active && "bg-muted text-foreground")}
                aria-pressed={active}
                disabled={preset.target === null}
                title={preset.id === "edit" && edit === null ? "No edit under review" : undefined}
                onClick={() => {
                  if (preset.target !== null) animateTo(preset.target);
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={chromeButton}
            aria-label="Zoom out"
            disabled={zoomLocked || view.span >= domain.extent - 1e-6}
            onClick={() => zoomBy(2, true)}
          >
            <ZoomOut className="size-3.5" aria-hidden />
          </button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="sr-only">Zoom level</span>
            <input
              type="range"
              min={0}
              max={SLIDER_STEPS}
              step={1}
              value={sliderValue}
              disabled={zoomLocked}
              aria-valuetext={`${Math.round(view.span)} codons visible`}
              className="h-1 w-32 cursor-pointer accent-primary"
              onChange={(event) => {
                const v = currentView();
                jump(zoomAround(v, sliderToSpan(Number(event.target.value), domain) / v.span, v.start + v.span / 2, domain));
              }}
            />
          </label>
          <button
            type="button"
            className={chromeButton}
            aria-label="Zoom in"
            disabled={zoomLocked || view.span <= domain.minSpan + 1e-6}
            onClick={() => zoomBy(0.5, true)}
          >
            <ZoomIn className="size-3.5" aria-hidden />
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className={chromeButton}
            aria-label="Pan towards codon 1"
            disabled={atStart}
            onClick={() => panBy(-view.span / 2)}
          >
            <ChevronLeft className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className={chromeButton}
            aria-label={`Pan towards codon ${domain.lastCodon}`}
            disabled={atEnd}
            onClick={() => panBy(view.span / 2)}
          >
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </div>

        <p className="ml-auto text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {windowText}
          {sequenceMode === "bases" && <> · bases from {locus.reference.label}</>}
          {sequenceMode === "residues" && <> · residues from {locus.reference.label}</>}
        </p>
      </div>

      <div
        ref={containerRef}
        tabIndex={0}
        role="group"
        aria-label="Gene track viewport. Arrow left and right pan; plus, minus or arrow up and down zoom; Home and End jump to either end."
        className={cn(
          "w-full touch-pan-y select-none rounded-md",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <svg
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          preserveAspectRatio="none"
          className="block text-foreground"
        >
          <title id={titleId}>{`${locus.gene} gene track, chromosome ${locus.chromosome}`}</title>
          <desc id={descId}>{descText}</desc>

          <defs>
            <pattern id={hatchId} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={5} className="stroke-muted-foreground" strokeWidth={1.25} strokeOpacity={0.6} />
            </pattern>
            <clipPath id={clipId}>
              <rect x={plotLeft} y={0} width={innerW} height={HEIGHT} />
            </clipPath>
          </defs>

          <g clipPath={`url(#${clipId})`}>
            {/* Modelled CDS window: a faint band plus a bracket. */}
            {cdsOnScreen && (
              <g aria-hidden>
                <rect
                  x={cdsX0}
                  y={Y.cdsBracket}
                  width={Math.max(0, cdsX1 - cdsX0)}
                  height={Y.axis - Y.cdsBracket}
                  className="fill-foreground"
                  fillOpacity={0.045}
                />
                <path
                  d={`M${cdsX0 + 0.5},${Y.cdsCap} V${Y.cdsBracket + 0.5} H${cdsX1 - 0.5} V${Y.cdsCap}`}
                  className="stroke-foreground"
                  strokeWidth={1}
                  fill="none"
                  strokeOpacity={0.7}
                />
              </g>
            )}

            {/* Intronic / inter-exon connector. */}
            {locus.exons.length > 0 && (
              <line
                x1={x(Math.min(...locus.exons.map((e) => e.codonStart)))}
                x2={x(Math.max(...locus.exons.map((e) => e.codonEnd)) + 1)}
                y1={(Y.exonTop + Y.exonBottom) / 2}
                y2={(Y.exonTop + Y.exonBottom) / 2}
                className="stroke-muted-foreground"
                strokeWidth={0.75}
              />
            )}

            {/* Exons: solid inside the modelled window, hatched context outside. */}
            {locus.exons.map((exon) => {
              const x0 = x(exon.codonStart) + 1;
              const x1 = x(exon.codonEnd + 1) - 1;
              return (
                <g key={exon.index}>
                  <title>{`${exon.label}, codons ${exon.codonStart}–${exon.codonEnd}. ${exon.note}`}</title>
                  {exonPieces(exon, modelStart, modelEnd).map((piece) => {
                    const px0 = Math.max(x0, x(piece.from));
                    const px1 = Math.min(x1, x(piece.to));
                    const w = Math.max(0, px1 - px0);
                    return piece.modelled ? (
                      <rect
                        key={piece.key}
                        x={px0}
                        y={Y.exonTop}
                        width={w}
                        height={Y.exonBottom - Y.exonTop}
                        className="fill-foreground"
                        fillOpacity={0.88}
                      />
                    ) : (
                      <g key={piece.key}>
                        <rect x={px0} y={Y.exonTop} width={w} height={Y.exonBottom - Y.exonTop} className="fill-muted" />
                        <rect
                          x={px0 + 0.375}
                          y={Y.exonTop + 0.375}
                          width={Math.max(0, w - 0.75)}
                          height={Y.exonBottom - Y.exonTop - 0.75}
                          fill={`url(#${hatchId})`}
                          className="stroke-muted-foreground"
                          strokeWidth={0.75}
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Codon-level sequence band. */}
            {sequenceMode !== "none" && (
              <g aria-hidden>
                {sequenceCodons.map((codon) => {
                  const cx0 = x(codon);
                  const cx1 = x(codon + 1);
                  const isEdit = codon === editCodon;
                  if (sequenceMode === "residues") {
                    const residue = codonResidue(locus, codon);
                    return (
                      <g key={codon}>
                        <line x1={cx0} x2={cx0} y1={Y.basesTop} y2={Y.basesBottom} className="stroke-border" strokeWidth={1} />
                        {residue !== null && (
                          <text
                            x={(cx0 + cx1) / 2}
                            y={Y.basesText}
                            textAnchor="middle"
                            fontSize={11}
                            className={cn("seq", isEdit ? "fill-primary" : "fill-foreground")}
                            fontWeight={isEdit ? 600 : 400}
                          >
                            {residue}
                          </text>
                        )}
                      </g>
                    );
                  }
                  const bases = codonBases(locus, codon);
                  return (
                    <g key={codon}>
                      <line x1={cx0} x2={cx0} y1={Y.basesTop} y2={Y.basesBottom} className="stroke-border" strokeWidth={1} />
                      {bases !== null &&
                        [0, 1, 2].map((k) => (
                          <text
                            key={k}
                            x={x(codon + (k + 0.5) / 3)}
                            y={Y.basesText}
                            textAnchor="middle"
                            fontSize={baseFont}
                            className="seq fill-foreground"
                          >
                            {bases.charAt(k)}
                          </text>
                        ))}
                      {isEdit &&
                        changedPositions.map((k) => (
                          <line
                            key={`chg-${k}`}
                            x1={x(codon + k / 3) + 2}
                            x2={x(codon + (k + 1) / 3) - 2}
                            y1={Y.basesBottom - 2}
                            y2={Y.basesBottom - 2}
                            className="stroke-primary"
                            strokeWidth={2}
                          />
                        ))}
                    </g>
                  );
                })}
                {sequenceCodons.length > 0 && (
                  <line
                    x1={x(Math.min(lastVisible, modelEnd) + 1)}
                    x2={x(Math.min(lastVisible, modelEnd) + 1)}
                    y1={Y.basesTop}
                    y2={Y.basesBottom}
                    className="stroke-border"
                    strokeWidth={1}
                  />
                )}
                {editCodon !== null && sequenceCodons.includes(editCodon) && (
                  <rect
                    x={x(editCodon) + 0.75}
                    y={Y.basesTop + 0.75}
                    width={Math.max(0, x(editCodon + 1) - x(editCodon) - 1.5)}
                    height={Y.basesBottom - Y.basesTop - 1.5}
                    rx={2}
                    fill="none"
                    className="stroke-primary"
                    strokeWidth={1.5}
                  />
                )}
                {notModelledSpans.map((span) => {
                  const text = "Not modelled";
                  const w = text.length * SANS_CHAR_PX;
                  if (span.x1 - span.x0 < w + LABEL_GAP * 2) return null;
                  return (
                    <text
                      key={span.x0}
                      x={(span.x0 + span.x1) / 2}
                      y={Y.basesText - 1}
                      textAnchor="middle"
                      fontSize={10}
                      className="fill-muted-foreground"
                    >
                      {text}
                    </text>
                  );
                })}
              </g>
            )}

            {/* Axis. */}
            <g aria-hidden>
              <line x1={plotLeft} x2={plotRight} y1={Y.axis + 0.5} y2={Y.axis + 0.5} className="stroke-border" strokeWidth={1} />
              {pxPerCodon >= RESIDUE_MIN_PX &&
                Array.from({ length: lastVisible - firstVisible + 2 }, (_, i) => firstVisible + i).map((c) => (
                  <line key={`b-${c}`} x1={x(c)} x2={x(c)} y1={Y.axis} y2={Y.axis + 2.5} className="stroke-border" strokeWidth={1} />
                ))}
              {axisTicks.map((tick) => (
                <line
                  key={`t-${tick.codon}`}
                  x1={tick.x}
                  x2={tick.x}
                  y1={Y.axis}
                  y2={Y.axisTick}
                  className="stroke-muted-foreground"
                  strokeWidth={1}
                />
              ))}
            </g>

            {/* Secondary marks: short ticks, subordinate to the edit marker. */}
            {markCodons.map((codon) => (
              <line
                key={`m-${codon}`}
                x1={x(codon + 0.5)}
                x2={x(codon + 0.5)}
                y1={Y.marksTop}
                y2={Y.marksBottom}
                className="stroke-muted-foreground"
                strokeWidth={1}
                aria-hidden
              />
            ))}

            {/* Edit marker: the one place the accent appears. */}
            {editX !== null && (
              <g aria-hidden>
                <line x1={editX} x2={editX} y1={Y.headBottom} y2={Y.axis} className="stroke-primary" strokeWidth={1.5} />
                <path
                  d={`M${editX - 4.5},${Y.headTop} H${editX + 4.5} L${editX},${Y.headBottom} Z`}
                  className="fill-primary"
                />
              </g>
            )}
          </g>

          {/* Labels sit outside the clip; each was placed inside the plot. */}
          <g aria-hidden>
            {cdsLabel !== null && (
              <text x={cdsLabel.x} y={Y.cdsLabel} textAnchor="middle" fontSize={11} className="fill-foreground">
                {cdsLabel.text}
              </text>
            )}

            {exonLabels.map((label) => (
              <text key={label.key} x={label.x} y={Y.exonLabel} textAnchor="middle" fontSize={11} className="fill-muted-foreground">
                {label.text}
              </text>
            ))}

            {axisTicks
              .filter((tick) => tick.label)
              .map((tick) => (
                <text
                  key={`l-${tick.codon}`}
                  x={tick.x}
                  y={Y.axisLabel}
                  textAnchor="middle"
                  fontSize={10}
                  className="fill-muted-foreground tabular-nums"
                >
                  {tick.codon}
                </text>
              ))}

            {edit !== null && callout !== null && (
              <text x={callout.x} y={Y.callout} textAnchor={callout.anchor} fontSize={11} className="fill-foreground">
                <tspan fontWeight={600}>{`Codon ${edit.codonIndex}`}</tspan>
                <tspan dx={12} className="seq">{`${codonText(edit.refCodon)}→${codonText(edit.altCodon)}`}</tspan>
                {edit.refAa !== null && edit.altAa !== null && (
                  <tspan dx={12} className="seq">{`${edit.refAa}→${edit.altAa}`}</tspan>
                )}
                {callout.withLabel && (
                  <tspan dx={12} className="fill-muted-foreground">
                    {edit.label}
                  </tspan>
                )}
              </text>
            )}

            {edit !== null && editOffscreen !== null && (
              <g>
                <path
                  d={
                    editOffscreen === "left"
                      ? `M${plotLeft},${Y.callout - 4} L${plotLeft + 6},${Y.callout - 8} V${Y.callout} Z`
                      : `M${plotRight},${Y.callout - 4} L${plotRight - 6},${Y.callout - 8} V${Y.callout} Z`
                  }
                  className="fill-primary"
                />
                <text
                  x={editOffscreen === "left" ? plotLeft + 10 : plotRight - 10}
                  y={Y.callout}
                  textAnchor={editOffscreen === "left" ? "start" : "end"}
                  fontSize={11}
                  className="fill-foreground"
                >
                  {`Edit at codon ${edit.codonIndex}, out of view`}
                </text>
              </g>
            )}
          </g>
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <LegendSwatch kind="solid" hatchId={hatchId} label="Modelled exon" />
        <LegendSwatch kind="hatch" hatchId={hatchId} label="Context, not modelled" />
        <LegendSwatch kind="bracket" hatchId={hatchId} label="CDS window" />
        {edit !== null && <LegendSwatch kind="edit" hatchId={hatchId} label="Edit" />}
        {markCodons.length > 0 && <LegendSwatch kind="mark" hatchId={hatchId} label="Marked codon" />}
      </div>

      <dl className="hairline grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t pt-3 text-xs">
        <dt className="text-muted-foreground">Gene</dt>
        <dd>
          <span className="font-medium">{locus.gene}</span> · {locus.name}
        </dd>
        <dt className="text-muted-foreground">Chromosome</dt>
        <dd>{locus.chromosome}</dd>
        <dt className="text-muted-foreground">Exons</dt>
        <dd>
          {locus.exons.length}, codons 1–{domain.lastCodon}; {modelledExonCount} overlap the modelled window
        </dd>
        <dt className="text-muted-foreground">Modelled</dt>
        <dd>
          Codons {modelStart}–{modelEnd}, {modelledNt} nt · {locus.reference.label}
        </dd>
        <dt className="text-muted-foreground">Edit</dt>
        <dd>
          {edit === null ? (
            "None, viewing the reference line"
          ) : (
            <>
              Codon {edit.codonIndex},{" "}
              <span className="seq">
                {codonText(edit.refCodon)}→{codonText(edit.altCodon)}
              </span>
              {edit.refAa !== null && edit.altAa !== null && (
                <>
                  {" "}
                  (<span className="seq">{edit.refAa}→{edit.altAa}</span>)
                </>
              )}
              {edit.proteinHgvs !== null && <> · {edit.proteinHgvs}</>}
            </>
          )}
        </dd>
      </dl>
    </section>
  );
}

function LegendSwatch({
  kind,
  hatchId,
  label,
}: {
  readonly kind: "solid" | "hatch" | "bracket" | "edit" | "mark";
  readonly hatchId: string;
  readonly label: string;
}): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width={18} height={10} viewBox="0 0 18 10" aria-hidden className="text-foreground">
        {kind === "solid" && <rect x={0} y={1} width={18} height={8} className="fill-foreground" fillOpacity={0.88} />}
        {kind === "hatch" && (
          <>
            <rect x={0} y={1} width={18} height={8} className="fill-muted" />
            <rect
              x={0.375}
              y={1.375}
              width={17.25}
              height={7.25}
              fill={`url(#${hatchId})`}
              className="stroke-muted-foreground"
              strokeWidth={0.75}
            />
          </>
        )}
        {kind === "bracket" && (
          <path d="M0.5,8 V2.5 H17.5 V8" fill="none" className="stroke-foreground" strokeOpacity={0.7} strokeWidth={1} />
        )}
        {kind === "edit" && (
          <>
            <path d="M4.5,0 H13.5 L9,5 Z" className="fill-primary" />
            <line x1={9} x2={9} y1={5} y2={10} className="stroke-primary" strokeWidth={1.5} />
          </>
        )}
        {kind === "mark" && <line x1={9} x2={9} y1={1} y2={9} className="stroke-muted-foreground" strokeWidth={1} />}
      </svg>
      {label}
    </span>
  );
}
