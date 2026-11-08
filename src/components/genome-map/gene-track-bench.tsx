'use client';

/**
 * The gene track: a measured instrument scale across the locus.
 *
 * Exons are drawn to codon coordinates from `data/loci.json`, the modelled
 * region is called out explicitly, and a marker sits on the edited codon.
 * Three zoom steps take it down to codon level.
 */

import { useMemo, useState } from 'react';
import { Microscope, Ruler, ZoomIn } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { ExonView, LocusView } from '@/app/bench/bench-types';

export interface GeneTrackProps {
  locus: LocusView;
  /** 1-based codon under edit, if the selected frame has one. */
  markerCodon: number | null;
  markerLabel: string | null;
  refCodon: string | null;
  altCodon: string | null;
  refAa: string | null;
  altAa: string | null;
}

type Zoom = 'locus' | 'modelled' | 'codon';

const W = 1000;
const H = 118;
const AXIS_Y = 74;
const PAD = 26;

function windowFor(zoom: Zoom, locus: LocusView, marker: number | null): [number, number] {
  const last = locus.exons.reduce((m, e) => Math.max(m, e.codonEnd), locus.codonCount);
  if (zoom === 'locus') return [1, last];
  if (zoom === 'modelled') return [1, locus.codonCount];
  const centre = marker ?? Math.round(locus.codonCount / 2);
  return [Math.max(1, centre - 6), Math.min(locus.codonCount, centre + 6)];
}

function tickStepFor(span: number): number {
  if (span <= 14) return 1;
  if (span <= 40) return 5;
  if (span <= 80) return 10;
  return 20;
}

export function GeneTrack({
  locus,
  markerCodon,
  markerLabel,
  refCodon,
  altCodon,
  refAa,
  altAa,
}: GeneTrackProps) {
  const [zoom, setZoom] = useState<Zoom>('modelled');
  const [from, to] = useMemo(() => windowFor(zoom, locus, markerCodon), [zoom, locus, markerCodon]);

  const span = Math.max(1, to - from);
  const x = (codon: number) => PAD + ((codon - from) / span) * (W - PAD * 2);
  const step = tickStepFor(span);
  const ticks: number[] = [];
  for (let c = Math.ceil(from / step) * step; c <= to; c += step) ticks.push(c === 0 ? 1 : c);
  if (ticks[0] !== from) ticks.unshift(from);

  const visibleExons = locus.exons.filter((e) => e.codonEnd >= from && e.codonStart <= to);
  const markerVisible = markerCodon !== null && markerCodon >= from && markerCodon <= to;

  return (
    <section
      aria-labelledby="gene-track-heading"
      className="bezel-surface rounded-xl border border-bezel-edge/70 p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="gene-track-heading"
            className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
          >
            <Ruler className="size-3.5" aria-hidden="true" />
            Locus scale
          </h2>
          <p className="mt-1 text-sm">
            <span className="font-mono font-semibold">{locus.gene}</span>
            <span className="text-muted-foreground"> · {locus.name} · chr{locus.chromosome}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="tnum font-mono">
            {locus.provenance}
          </Badge>
          <ToggleGroup
            value={[zoom]}
            onValueChange={(next) => {
              const first = Array.isArray(next) ? next[0] : next;
              if (first === 'locus' || first === 'modelled' || first === 'codon') setZoom(first);
            }}
            aria-label="Gene track zoom"
          >
            <ToggleGroupItem value="locus" aria-label="Whole locus">
              <Ruler className="size-3.5" aria-hidden="true" />
              Locus
            </ToggleGroupItem>
            <ToggleGroupItem value="modelled" aria-label="Modelled region">
              <Microscope className="size-3.5" aria-hidden="true" />
              Modelled
            </ToggleGroupItem>
            <ToggleGroupItem value="codon" aria-label="Codon level">
              <ZoomIn className="size-3.5" aria-hidden="true" />
              Codon
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={
          `Gene track for ${locus.gene}, codons ${from} to ${to}. ` +
          visibleExons
            .map(
              (e) =>
                `${e.label}, codons ${e.codonStart} to ${e.codonEnd}, ` +
                `${e.modelled ? 'modelled' : 'shown for context only'}.`,
            )
            .join(' ') +
          (markerCodon !== null ? ` Marker at codon ${markerCodon}.` : ' No edited codon.')
        }
      >
        {/* Intron line through the whole window. */}
        <line
          x1={PAD}
          x2={W - PAD}
          y1={AXIS_Y - 11}
          y2={AXIS_Y - 11}
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-muted-foreground/50"
        />

        {/* Exon blocks, to codon coordinates. */}
        {visibleExons.map((e: ExonView) => {
          const x1 = x(Math.max(from, e.codonStart));
          const x2 = x(Math.min(to, e.codonEnd));
          return (
            <g key={e.index}>
              <rect
                x={x1}
                y={AXIS_Y - 26}
                width={Math.max(2, x2 - x1)}
                height={30}
                rx={3}
                className={
                  e.modelled
                    ? 'fill-signal/25 stroke-signal'
                    : 'fill-muted-foreground/12 stroke-muted-foreground/45'
                }
                strokeWidth={1}
              />
              <text
                x={x1 + 6}
                y={AXIS_Y - 31}
                className="fill-muted-foreground text-[10px]"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {e.label}
                {e.modelled ? '' : ' (context)'}
              </text>
            </g>
          );
        })}

        {/* Measured scale. */}
        <line
          x1={PAD}
          x2={W - PAD}
          y1={AXIS_Y + 14}
          y2={AXIS_Y + 14}
          stroke="currentColor"
          strokeWidth={1}
          className="text-foreground/40"
        />
        {ticks.map((c) => (
          <g key={c}>
            <line
              x1={x(c)}
              x2={x(c)}
              y1={AXIS_Y + 14}
              y2={AXIS_Y + 21}
              stroke="currentColor"
              strokeWidth={1}
              className="text-foreground/40"
            />
            <text
              x={x(c)}
              y={AXIS_Y + 33}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {c}
            </text>
          </g>
        ))}
        {span <= 14
          ? Array.from({ length: to - from + 1 }, (_, i) => from + i).map((c) => (
              <line
                key={`minor-${c}`}
                x1={x(c)}
                x2={x(c)}
                y1={AXIS_Y + 10}
                y2={AXIS_Y + 14}
                stroke="currentColor"
                strokeWidth={0.75}
                className="text-foreground/25"
              />
            ))
          : null}
        <text
          x={PAD}
          y={H - 2}
          className="fill-muted-foreground text-[10px]"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          codon {from}
        </text>
        <text
          x={W - PAD}
          y={H - 2}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          codon {to}
        </text>

        {/* Marker at the edited codon. */}
        {markerVisible && markerCodon !== null ? (
          <g>
            <line
              x1={x(markerCodon)}
              x2={x(markerCodon)}
              y1={AXIS_Y - 34}
              y2={AXIS_Y + 21}
              stroke="currentColor"
              strokeWidth={1.5}
              className="text-signal-alarm"
            />
            <polygon
              points={`${x(markerCodon) - 5},${AXIS_Y - 40} ${x(markerCodon) + 5},${AXIS_Y - 40} ${x(markerCodon)},${AXIS_Y - 32}`}
              className="fill-signal-alarm"
            />
            <text
              x={x(markerCodon)}
              y={AXIS_Y - 45}
              textAnchor="middle"
              className="fill-signal-alarm text-[10px] font-semibold"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {refCodon !== null && altCodon !== null
                ? `c.${markerCodon} ${refCodon}→${altCodon}`
                : `c.${markerCodon}`}
              {refAa !== null && altAa !== null ? ` · ${refAa}→${altAa}` : ''}
            </text>
          </g>
        ) : null}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-signal/40 ring-1 ring-signal" />
          modelled region ({locus.codonCount} codons)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-sm bg-muted-foreground/20 ring-1 ring-muted-foreground/50"
          />
          shown for context, not modelled
        </span>
        {markerLabel !== null ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-sm bg-signal-alarm" />
            {markerLabel}
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{locus.note}</p>
    </section>
  );
}
