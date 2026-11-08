'use client';

/**
 * The gene-track diagram (SPEC §5, mandatory and prominent).
 *
 * An SVG locus map of the gene under edit: exons drawn to scale in codon
 * coordinates, the modelled region distinguished from the un-modelled context
 * exons, and a marker at the edited codon. Zoomable from the whole locus down
 * to individual codons.
 *
 * In this variant it renders twice from the same component: as a narrow
 * minimap strip pinned above the diff (`compact`), and as the full zoomable
 * track when that strip is expanded.
 *
 * Every coordinate comes from `data/loci.json`. Nothing here is decorative
 * filler: the context exons are drawn greyed precisely because the fixture
 * says they are not modelled.
 */

import type { MouseEvent } from 'react';

import type { Exon } from '@/lib/loci';

export type TrackZoom = 'locus' | 'exon' | 'codon';

export interface CodonTick {
  readonly codonIndex: number;
  readonly refAa: string | null;
  readonly altAa: string | null;
  readonly changed: boolean;
  readonly silent: boolean;
}

export interface GeneTrackProps {
  readonly gene: string;
  readonly chromosome: string;
  readonly exons: readonly Exon[];
  readonly modelledCodonCount: number;
  readonly totalCodonCount: number;
  readonly markerCodon: number | null;
  readonly zoom: TrackZoom;
  readonly ticks?: readonly CodonTick[];
  readonly compact?: boolean;
  /** Called with a codon index when the user clicks the track. */
  readonly onSeek?: (codonIndex: number) => void;
}

const WIDTH = 960;

function windowFor(
  zoom: TrackZoom,
  marker: number | null,
  modelledCodonCount: number,
  totalCodonCount: number,
): readonly [number, number] {
  if (zoom === 'locus') return [1, totalCodonCount];
  if (zoom === 'exon') return [1, modelledCodonCount];
  const centre = marker ?? Math.round(modelledCodonCount / 2);
  const half = 6;
  const start = Math.max(1, centre - half);
  return [start, Math.min(totalCodonCount, start + half * 2)];
}

export function GeneTrack({
  gene,
  chromosome,
  exons,
  modelledCodonCount,
  totalCodonCount,
  markerCodon,
  zoom,
  ticks = [],
  compact = false,
  onSeek,
}: GeneTrackProps) {
  const padX = compact ? 10 : 18;
  const height = compact ? 44 : 150;
  const [w0, w1] = windowFor(zoom, markerCodon, modelledCodonCount, totalCodonCount);
  const span = Math.max(w1 - w0 + 1, 1);
  const inner = WIDTH - padX * 2;

  const x = (codon: number): number => padX + ((codon - w0) / span) * inner;
  const axisY = compact ? 26 : 74;
  const exonH = compact ? 13 : 30;

  const visibleTicks =
    zoom === 'codon' && !compact ? ticks.filter((t) => t.codonIndex >= w0 && t.codonIndex <= w1) : [];

  const rulerStep = zoom === 'locus' ? 20 : zoom === 'exon' ? 5 : 1;
  const rulerMarks: number[] = [];
  for (let c = Math.ceil(w0 / rulerStep) * rulerStep; c <= w1; c += rulerStep) {
    rulerMarks.push(c === 0 ? 1 : c);
  }

  const markerX = markerCodon === null ? null : x(markerCodon);
  const markerVisible = markerCodon !== null && markerCodon >= w0 && markerCodon <= w1;

  const handleClick = (event: MouseEvent<SVGSVGElement>): void => {
    if (onSeek === undefined) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const codon = Math.round(w0 + ratio * span);
    onSeek(Math.min(Math.max(codon, 1), totalCodonCount));
  };

  const describedBy = `gene-track-desc-${compact ? 'mini' : 'full'}`;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      className={`block h-auto w-full ${onSeek === undefined ? '' : 'cursor-crosshair'}`}
      role="img"
      aria-labelledby={describedBy}
      onClick={handleClick}
    >
      <desc id={describedBy}>
        {`Gene track for ${gene} on chromosome ${chromosome}. ${exons.length} exons spanning codons 1 to ${totalCodonCount}; codons 1 to ${modelledCodonCount} are modelled in this prototype.` +
          (markerCodon === null ? ' No edited codon.' : ` A marker sits at the edited codon ${markerCodon}.`)}
      </desc>

      {/* Intron backbone across the whole visible window. */}
      <line
        x1={padX}
        x2={WIDTH - padX}
        y1={axisY + exonH / 2}
        y2={axisY + exonH / 2}
        stroke="var(--intron)"
        strokeWidth={compact ? 2 : 3}
      />

      {/* Intron chevrons, the conventional direction-of-transcription marks. */}
      {!compact &&
        exons.slice(0, -1).map((exon, i) => {
          const next = exons[i + 1];
          const mid = (x(exon.codonEnd + 1) + x(next.codonStart)) / 2;
          if (mid < padX || mid > WIDTH - padX) return null;
          return (
            <path
              key={`chev-${exon.index}`}
              d={`M ${mid - 5} ${axisY + exonH / 2 - 6} L ${mid + 4} ${axisY + exonH / 2} L ${mid - 5} ${axisY + exonH / 2 + 6}`}
              fill="none"
              stroke="var(--intron)"
              strokeWidth={2}
              strokeLinecap="round"
            />
          );
        })}

      {/* Exons. The modelled exon is solid; context exons are greyed because
          the fixture states they are not modelled. */}
      {exons.map((exon) => {
        // Modelled only if the whole exon falls inside the modelled region.
        const modelled = exon.codonEnd <= modelledCodonCount;
        const left = Math.max(x(exon.codonStart), padX);
        const right = Math.min(x(exon.codonEnd + 1), WIDTH - padX);
        const w = right - left;
        if (w <= 0) return null;
        return (
          <g key={exon.index}>
            <rect
              x={left}
              y={axisY}
              width={Math.max(w, 2)}
              height={exonH}
              rx={compact ? 2 : 4}
              fill={modelled ? 'var(--exon-modelled)' : 'var(--exon-context)'}
              fillOpacity={modelled ? 0.9 : 1}
            />
            {!compact && w > 54 && (
              <text
                x={left + w / 2}
                y={axisY + exonH / 2 + 4}
                textAnchor="middle"
                className="text-[11px] font-semibold"
                style={{ fill: modelled ? 'var(--background)' : 'var(--muted-foreground)' }}
              >
                {exon.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Codon-level ticks: real amino acids from the real diff. */}
      {visibleTicks.map((tick) => {
        const left = x(tick.codonIndex);
        const w = inner / span;
        const colour = !tick.changed
          ? 'var(--diff-same-fg)'
          : tick.silent
            ? 'var(--diff-silent)'
            : 'var(--diff-changed)';
        return (
          <g key={`tick-${tick.codonIndex}`}>
            <rect
              x={left + 1}
              y={axisY + exonH + 6}
              width={Math.max(w - 2, 2)}
              height={22}
              rx={3}
              fill={tick.changed ? (tick.silent ? 'var(--diff-silent-bg)' : 'var(--diff-changed-bg)') : 'transparent'}
              stroke={tick.changed ? colour : 'var(--border)'}
              strokeWidth={1}
            />
            <text
              x={left + w / 2}
              y={axisY + exonH + 22}
              textAnchor="middle"
              className="text-[12px] font-semibold"
              style={{ fill: colour, fontFamily: 'var(--font-mono)' }}
            >
              {tick.altAa ?? '–'}
            </text>
          </g>
        );
      })}

      {/* Codon ruler. */}
      {rulerMarks.map((c) => {
        const left = x(c);
        if (left < padX - 1 || left > WIDTH - padX + 1) return null;
        return (
          <g key={`ruler-${c}`}>
            <line
              x1={left}
              x2={left}
              y1={axisY + exonH + (compact ? 2 : 1)}
              y2={axisY + exonH + (compact ? 6 : 5)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            {!compact && (
              <text
                x={left}
                y={axisY - 10}
                textAnchor="middle"
                className="nums text-[10px]"
                style={{ fill: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}
              >
                {c}
              </text>
            )}
          </g>
        );
      })}

      {/* The marker at the edited codon. */}
      {markerVisible && markerX !== null && (
        <g>
          <line
            x1={markerX}
            x2={markerX}
            y1={compact ? 6 : axisY - 26}
            y2={axisY + exonH + (compact ? 8 : 34)}
            stroke="var(--marker)"
            strokeWidth={compact ? 1.5 : 2}
          />
          <path
            d={`M ${markerX - (compact ? 4 : 6)} ${compact ? 4 : axisY - 28} L ${markerX + (compact ? 4 : 6)} ${
              compact ? 4 : axisY - 28
            } L ${markerX} ${compact ? 11 : axisY - 18} Z`}
            fill="var(--marker)"
          />
          {!compact && (
            <text
              x={Math.min(Math.max(markerX, 44), WIDTH - 44)}
              y={axisY + exonH + 50}
              textAnchor="middle"
              className="nums text-[12px] font-semibold"
              style={{ fill: 'var(--marker)', fontFamily: 'var(--font-mono)' }}
            >
              codon {markerCodon}
            </text>
          )}
        </g>
      )}

      {/* Modelled-region bracket, so "what this prototype actually covers" is
          legible rather than implied. */}
      {!compact && zoom === 'locus' && (
        <g>
          <line
            x1={x(1)}
            x2={x(modelledCodonCount + 1)}
            y1={axisY + exonH + 14}
            y2={axisY + exonH + 14}
            stroke="var(--exon-modelled)"
            strokeWidth={2}
          />
          <text
            x={x(modelledCodonCount + 1) + 8}
            y={axisY + exonH + 18}
            className="text-[10px]"
            style={{ fill: 'var(--muted-foreground)' }}
          >
            codons 1–{modelledCodonCount} modelled · {modelledCodonCount + 1}–{totalCodonCount} shown for context only
          </text>
        </g>
      )}
    </svg>
  );
}
