'use client';

/**
 * The centre pane: the diff, read as a pull request.
 *
 * Three synchronised registers stacked per codon — DNA, codon, amino acid —
 * with line-number-style codon indices down the left and a change gutter.
 *
 * The distinction SPEC §5 insists on: a silent substitution (DNA changed,
 * amino acid did not) is drawn in a different hue, with a different gutter
 * glyph and a different screen-reader label, from an amino-acid-changing one.
 * Colour is never the only carrier.
 */

import {
  ArrowRight,
  CircleDot,
  Equal,
  Minus,
  MoveRight,
  Plus,
} from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import type { DiffRow } from '@/lib/genome';

export interface DiffStackProps {
  readonly rows: readonly DiffRow[];
  readonly refLabel: string;
  readonly altLabel: string;
  readonly focusCodon: number | null;
  readonly onFocusCodon: (codonIndex: number) => void;
  /** Hide unchanged runs the way a diff hides context. */
  readonly changesOnly: boolean;
}

interface RowStyle {
  readonly rowBg: string;
  readonly fg: string;
  readonly gutterGlyph: typeof Equal;
  readonly gutterChar: string;
  readonly srLabel: string;
}

function styleFor(row: DiffRow): RowStyle {
  if (row.status === 'added') {
    return {
      rowBg: 'bg-diff-added-bg',
      fg: 'text-diff-added',
      gutterGlyph: Plus,
      gutterChar: '+',
      srLabel: 'codon added',
    };
  }
  if (row.status === 'removed') {
    return {
      rowBg: 'bg-diff-removed-bg',
      fg: 'text-diff-removed',
      gutterGlyph: Minus,
      gutterChar: '-',
      srLabel: 'codon removed',
    };
  }
  if (row.status === 'changed' && row.silent) {
    return {
      rowBg: 'bg-diff-silent-bg',
      fg: 'text-diff-silent',
      gutterGlyph: CircleDot,
      gutterChar: '≡',
      srLabel: 'silent substitution — codon changed, amino acid unchanged',
    };
  }
  if (row.status === 'changed') {
    return {
      rowBg: 'bg-diff-changed-bg',
      fg: 'text-diff-changed',
      gutterGlyph: MoveRight,
      gutterChar: '~',
      srLabel: 'substitution — amino acid changed',
    };
  }
  return {
    rowBg: '',
    fg: 'text-diff-same-fg',
    gutterGlyph: Equal,
    gutterChar: ' ',
    srLabel: 'unchanged',
  };
}

/** Three bases, each its own glyph, with changed bases underlined. */
function BaseRegister({
  codon,
  other,
  tone,
}: {
  readonly codon: string | null;
  readonly other: string | null;
  readonly tone: string;
}) {
  if (codon === null) {
    return <span className="text-muted-foreground">···</span>;
  }
  return (
    <span className="seq tracking-[0.18em]">
      {[...codon].map((base, i) => {
        const differs = other !== null && other[i] !== base;
        return (
          <span
            key={`${i}-${base}`}
            className={differs ? `${tone} font-semibold underline decoration-2 underline-offset-2` : undefined}
          >
            {base}
          </span>
        );
      })}
    </span>
  );
}

export function DiffStack({
  rows,
  refLabel,
  altLabel,
  focusCodon,
  onFocusCodon,
  changesOnly,
}: DiffStackProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    if (!changesOnly) return rows;
    const keep = new Set<number>();
    rows.forEach((row, i) => {
      if (row.status === 'same') return;
      for (let j = i - 2; j <= i + 2; j += 1) if (j >= 0 && j < rows.length) keep.add(j);
    });
    return rows.filter((_, i) => keep.has(i));
  }, [rows, changesOnly]);

  // Jump to the focused codon the way an editor jumps to a line.
  useEffect(() => {
    if (focusCodon === null) return;
    const node = scrollRef.current?.querySelector<HTMLElement>(`[data-codon="${focusCodon}"]`);
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusCodon, visible]);

  const changed = rows.filter((r) => r.status !== 'same');
  const silent = changed.filter((r) => r.silent);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Register key — the header row of a three-register diff. */}
      <div className="flex shrink-0 items-center gap-4 border-b border-border bg-gutter px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-mono">
          <span className="text-muted-foreground">ref</span>
          <span className="text-foreground">{refLabel}</span>
        </span>
        <ArrowRight className="size-3.5 shrink-0" aria-hidden />
        <span className="inline-flex items-center gap-1.5 font-mono">
          <span className="text-muted-foreground">alt</span>
          <span className="text-foreground">{altLabel}</span>
        </span>
        <span className="ml-auto nums">
          {rows.length} codons · {changed.length} changed · {silent.length} silent
        </span>
      </div>

      {/* Column labels, pinned. */}
      <div
        className="grid shrink-0 items-center gap-0 border-b border-border bg-card px-0 py-1 text-[10px] tracking-wide text-muted-foreground uppercase"
        style={{ gridTemplateColumns: '3.25rem 1.5rem 1fr 1fr' }}
      >
        <span className="pr-2 text-right">codon</span>
        <span aria-hidden />
        <span className="pl-2">reference · DNA / codon / AA</span>
        <span className="pl-2">altered · DNA / codon / AA</span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto text-[12.5px]">
        <table className="w-full border-collapse">
          <caption className="sr-only normal-case tracking-normal">
            Row-per-codon diff of {refLabel} against {altLabel}, in three synchronised registers:
            DNA bases, codon, and translated amino acid.
          </caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Codon index</th>
              <th scope="col">Change</th>
              <th scope="col">Reference codon and amino acid</th>
              <th scope="col">Altered codon and amino acid</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const s = styleFor(row);
              const Glyph = s.gutterGlyph;
              const focused = focusCodon === row.codonIndex;
              return (
                <tr
                  key={row.codonIndex}
                  data-codon={row.codonIndex}
                  className={`group border-b border-border/40 ${s.rowBg} ${
                    focused ? 'outline-2 -outline-offset-2 outline-ring' : ''
                  }`}
                >
                  {/* Line-number-like codon index. */}
                  <th
                    scope="row"
                    className="w-[3.25rem] border-r border-border/60 bg-gutter px-2 py-[3px] text-right align-top font-normal"
                  >
                    <button
                      type="button"
                      onClick={() => onFocusCodon(row.codonIndex)}
                      className="nums w-full rounded-sm text-right text-[11px] text-muted-foreground hover:text-foreground focus-visible:text-foreground"
                      aria-label={`Focus codon ${row.codonIndex}`}
                    >
                      {row.codonIndex}
                    </button>
                  </th>

                  {/* Change gutter: glyph + character, not colour alone. */}
                  <td className={`w-6 px-0 py-[3px] text-center align-top ${s.fg}`}>
                    <Glyph className="mx-auto size-3.5" aria-hidden />
                    <span className="sr-only">{s.srLabel}</span>
                  </td>

                  {/* Reference register. */}
                  <td className="seq px-2 py-[3px] align-top">
                    <div className="flex items-baseline gap-3">
                      <BaseRegister codon={row.refCodon} other={row.altCodon} tone={s.fg} />
                      <span className="seq text-[10px] text-muted-foreground">
                        {row.refCodon ?? '—'}
                      </span>
                      <span className={`seq ml-auto text-[13px] font-semibold ${s.fg}`}>
                        {row.refAa ?? '—'}
                      </span>
                    </div>
                  </td>

                  {/* Altered register. */}
                  <td className="seq border-l border-border/60 px-2 py-[3px] align-top">
                    <div className="flex items-baseline gap-3">
                      <BaseRegister codon={row.altCodon} other={row.refCodon} tone={s.fg} />
                      <span className="seq text-[10px] text-muted-foreground">
                        {row.altCodon ?? '—'}
                      </span>
                      <span className={`seq ml-auto text-[13px] font-semibold ${s.fg}`}>
                        {row.altAa ?? '—'}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {changed.length === 0 && (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            No codon differs between {refLabel} and {altLabel} — this branch introduces no edit
            against its base.
          </p>
        )}
      </div>

      {/* Legend. Silent vs amino-acid-changing is the distinction that matters. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-gutter px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <MoveRight className="size-3.5 text-diff-changed" aria-hidden />
          <span className="text-diff-changed">~</span> amino-acid change
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CircleDot className="size-3.5 text-diff-silent" aria-hidden />
          <span className="text-diff-silent">≡</span> silent (synonymous)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Plus className="size-3.5 text-diff-added" aria-hidden /> added
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Minus className="size-3.5 text-diff-removed" aria-hidden /> removed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Equal className="size-3.5" aria-hidden /> unchanged
        </span>
      </div>
    </div>
  );
}
