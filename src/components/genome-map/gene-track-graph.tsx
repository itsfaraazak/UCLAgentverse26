'use client';

import { useId, useMemo, useState } from 'react';
import { Microscope, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { EditView, LocusView } from '@/lib/demo/view';

const WIDTH = 660;
const TRACK_Y = 74;
const TRACK_H = 26;
const AXIS_Y = 126;

export interface GeneTrackProps {
  readonly locus: LocusView;
  readonly edit: EditView | null;
  /** Every codon this commit's genotype differs from the reference at. */
  readonly changedCodons: readonly number[];
}

type Scope = 'gene' | 'modelled' | 'codon';

/**
 * SVG gene track for the locus under edit: the exon structure, the modelled
 * CDS window, and a marker at the edited codon. Zoomable from the whole gene
 * down to codon level (SPEC §5).
 */
export function GeneTrack({ locus, edit, changedCodons }: GeneTrackProps) {
  const [scope, setScope] = useState<Scope>('modelled');
  const titleId = useId();
  const descId = useId();

  const marked = edit?.codonIndex ?? changedCodons[0] ?? null;

  const window = useMemo(() => {
    if (scope === 'gene') return { from: 1, to: locus.totalCodons };
    if (scope === 'modelled') return { from: 1, to: locus.codonCount };
    if (marked === null) return { from: 1, to: locus.codonCount };
    const half = 6;
    return {
      from: Math.max(1, marked - half),
      to: Math.min(locus.codonCount, marked + half),
    };
  }, [scope, locus.totalCodons, locus.codonCount, marked]);

  const span = Math.max(1, window.to - window.from + 1);
  const padX = 26;
  const usable = WIDTH - padX * 2;
  /** Left edge of codon n. */
  const xOf = (codon: number): number => padX + ((codon - window.from) / span) * usable;
  const codonWidth = usable / span;
  const visible = (codon: number): boolean => codon >= window.from && codon <= window.to;

  const codonTicks = codonWidth >= 13;
  const bases = locus.referenceBases;

  const description =
    `Gene track for ${locus.gene} (${locus.name}), chromosome ${locus.chromosome}. ` +
    `${locus.exons.length} annotated exons spanning ${locus.totalCodons} codons; ` +
    `codons 1 to ${locus.codonCount} are modelled in this prototype. ` +
    (marked === null
      ? 'No edited codon is marked.'
      : `A marker sits at codon ${marked}${
          edit === null
            ? ''
            : `, where ${edit.refCodon} (${edit.refAaName}) becomes ${edit.altCodon} (${edit.altAaName})`
        }.`);

  return (
    <section className="flex flex-col gap-3" aria-label="Gene track diagram">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Microscope className="size-4 text-muted-foreground" aria-hidden="true" />
          Gene track
        </h3>
        <p className="text-[11.5px] text-muted-foreground">
          <span className="font-mono">{locus.gene}</span> · {locus.name} · chr{locus.chromosome}
        </p>
        <ToggleGroup
          value={[scope]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === 'gene' || next === 'modelled' || next === 'codon') setScope(next);
          }}
          className="ml-auto"
          aria-label="Gene track zoom level"
        >
          <ToggleGroupItem value="gene" aria-label="Show the whole gene">
            <ZoomOut aria-hidden="true" />
            Gene
          </ToggleGroupItem>
          <ToggleGroupItem value="modelled" aria-label="Show the modelled region">
            Modelled
          </ToggleGroupItem>
          <ToggleGroupItem
            value="codon"
            aria-label="Zoom to the edited codon"
            disabled={marked === null}
          >
            <ZoomIn aria-hidden="true" />
            Codon
          </ToggleGroupItem>
        </ToggleGroup>
      </header>

      <div className="hairline overflow-hidden rounded-lg border">
        <svg
          viewBox={`0 0 ${WIDTH} 152`}
          className="h-auto w-full"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
        >
          <title id={titleId}>{locus.gene} gene track</title>
          <desc id={descId}>{description}</desc>

          {/* Intron line through the whole visible span */}
          <line
            x1={padX}
            y1={TRACK_Y + TRACK_H / 2}
            x2={WIDTH - padX}
            y2={TRACK_Y + TRACK_H / 2}
            stroke="var(--border)"
            strokeWidth={2}
          />

          {/* Exons */}
          {locus.exons.map((exon) => {
            const from = Math.max(exon.codonStart, window.from);
            const to = Math.min(exon.codonEnd, window.to);
            if (to < from) return null;
            const x = xOf(from);
            const w = Math.max(3, (to - from + 1) * codonWidth);
            return (
              <g key={exon.index}>
                <rect
                  x={x}
                  y={TRACK_Y}
                  width={w}
                  height={TRACK_H}
                  rx={4}
                  fill={exon.modelled ? 'var(--primary)' : 'var(--muted)'}
                  fillOpacity={exon.modelled ? (exon.partiallyModelled ? 0.12 : 0.22) : 1}
                  stroke={exon.modelled ? 'var(--primary)' : 'var(--border)'}
                  strokeWidth={exon.modelled ? 1.5 : 1}
                  strokeDasharray={exon.partiallyModelled ? '4 3' : undefined}
                />
                {w > 52 && (
                  <text
                    x={x + w / 2}
                    y={TRACK_Y + TRACK_H / 2 + 3.5}
                    textAnchor="middle"
                    className="fill-foreground/70 text-[9px] font-medium"
                  >
                    {exon.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Modelled-window bracket */}
          {window.from <= locus.codonCount && (
            <g>
              <rect
                x={xOf(Math.max(1, window.from))}
                y={TRACK_Y - 13}
                width={Math.max(
                  2,
                  (Math.min(locus.codonCount, window.to) - Math.max(1, window.from) + 1) *
                    codonWidth,
                )}
                height={5}
                rx={2.5}
                fill="var(--primary)"
                fillOpacity={0.5}
              />
              <text
                x={xOf(Math.max(1, window.from))}
                y={TRACK_Y - 19}
                className="fill-muted-foreground text-[9px]"
              >
                modelled CDS · codons 1–{locus.codonCount}
              </text>
            </g>
          )}

          {/* Codon ruler, when zoomed in far enough to be legible */}
          {codonTicks &&
            Array.from({ length: span }, (_, i) => window.from + i).map((codon) => {
              if (codon > locus.codonCount) return null;
              const x = xOf(codon);
              const codonBases = bases.slice((codon - 1) * 3, codon * 3);
              const isMarked = codon === marked;
              const isChanged = changedCodons.includes(codon);
              return (
                <g key={codon}>
                  <rect
                    x={x + 1}
                    y={AXIS_Y - 22}
                    width={codonWidth - 2}
                    height={18}
                    rx={3}
                    fill={
                      isMarked
                        ? 'var(--verdict-escalate)'
                        : isChanged
                          ? 'var(--verdict-conflict)'
                          : 'var(--muted)'
                    }
                    fillOpacity={isMarked || isChanged ? 0.22 : 1}
                    stroke={
                      isMarked
                        ? 'var(--verdict-escalate)'
                        : isChanged
                          ? 'var(--verdict-conflict)'
                          : 'var(--border)'
                    }
                    strokeWidth={isMarked ? 1.5 : 1}
                  />
                  <text
                    x={x + codonWidth / 2}
                    y={AXIS_Y - 9}
                    textAnchor="middle"
                    className="fill-foreground seq text-[8.5px]"
                  >
                    {codonBases}
                  </text>
                  <text
                    x={x + codonWidth / 2}
                    y={AXIS_Y + 8}
                    textAnchor="middle"
                    className="fill-muted-foreground font-mono text-[8px]"
                  >
                    {codon}
                  </text>
                </g>
              );
            })}

          {/* Coarse axis labels when the codon ruler is too dense */}
          {!codonTicks && (
            <>
              <text x={padX} y={AXIS_Y - 6} className="fill-muted-foreground text-[9px]">
                codon {window.from}
              </text>
              <text
                x={WIDTH - padX}
                y={AXIS_Y - 6}
                textAnchor="end"
                className="fill-muted-foreground text-[9px]"
              >
                codon {window.to}
              </text>
            </>
          )}

          {/* The edit marker — a lollipop at the edited codon */}
          {marked !== null && visible(marked) && (
            <g>
              <line
                x1={xOf(marked) + codonWidth / 2}
                y1={26}
                x2={xOf(marked) + codonWidth / 2}
                y2={TRACK_Y + TRACK_H}
                stroke="var(--verdict-escalate)"
                strokeWidth={1.75}
              />
              <circle
                cx={xOf(marked) + codonWidth / 2}
                cy={20}
                r={7.5}
                fill="var(--verdict-escalate)"
              />
              <circle
                cx={xOf(marked) + codonWidth / 2}
                cy={20}
                r={3}
                fill="var(--card)"
              />
              <text
                x={xOf(marked) + codonWidth / 2}
                y={44}
                textAnchor="middle"
                className="fill-foreground text-[9.5px] font-semibold"
              >
                {edit === null ? (
                  `codon ${marked}`
                ) : (
                  <>
                    {`codon ${marked} · `}
                    <tspan className="seq">{`${edit.refCodon}→${edit.altCodon}`}</tspan>
                  </>
                )}
              </text>
              {edit !== null && (
                <text
                  x={xOf(marked) + codonWidth / 2}
                  y={56}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[9px]"
                >
                  {edit.refAaName} → {edit.altAaName}
                </text>
              )}
            </g>
          )}
        </svg>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        This prototype models codons 1–{locus.codonCount} of {locus.gene}&rsquo;s{' '}
        {locus.totalCodons}-codon coding sequence — enough to diff and translate the worked
        example. Exons drawn with a dashed edge extend past the modelled window; solid grey
        exons are annotation context only. Structural annotations are textbook teaching
        summaries, not structure-prediction output.
        {locus.declaredCodonCount !== null && (
          <>
            {' '}
            <span className="text-conflict">
              Note: the fixture declares {locus.declaredCodonCount} codons, but its sequence is{' '}
              {locus.codonCount * 3}&nbsp;nt — {locus.codonCount} codons. The sequence is taken
              as authoritative here, so this track agrees with the diff.
            </span>
          </>
        )}
      </p>
      {marked !== null && scope !== 'codon' && (
        <Button
          variant="outline"
          size="xs"
          className="self-start"
          onClick={() => setScope('codon')}
        >
          <ZoomIn aria-hidden="true" />
          Zoom to codon {marked}
        </Button>
      )}
    </section>
  );
}
