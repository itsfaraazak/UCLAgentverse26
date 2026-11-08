'use client';

/**
 * Three synchronised registers over one codon grid: DNA bases, codons, and
 * amino acids. Every row comes from `diffSequences`, so the alignment is the
 * module's, not the component's.
 */

import { ArrowRight } from 'lucide-react';
import { cn } from 'cn';
import type { DiffRow } from '@/lib/genome';

export interface RegistersProps {
  rows: readonly DiffRow[];
  refLabel: string;
  altLabel: string;
  /** Codon to scroll-highlight, if any. */
  focusCodon: number | null;
}

function baseTone(refCodon: string | null, altCodon: string | null, i: number): string {
  if (refCodon === null || altCodon === null) return 'text-foreground';
  return refCodon[i] === altCodon[i] ? 'text-muted-foreground' : 'text-signal-alarm font-semibold';
}

export function Registers({ rows, refLabel, altLabel, focusCodon }: RegistersProps) {
  return (
    <div className="recess-surface rounded-lg border border-border">
      <div className="grid grid-cols-[7.5rem_1fr]">
        <div className="flex flex-col justify-around border-r border-border px-3 py-2 text-[0.625rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
          <span className="py-1">Codon</span>
          <span className="truncate py-1" title={refLabel}>
            {refLabel}
          </span>
          <span className="truncate py-1" title={altLabel}>
            {altLabel}
          </span>
          <span className="py-1">Amino acid</span>
        </div>

        <div className="overflow-x-auto">
          <table className="tnum border-collapse text-xs">
            <caption className="sr-only">
              {`Codon-by-codon diff between ${refLabel} and ${altLabel}, in three registers: DNA bases, codons and amino acids.`}
            </caption>
            <tbody>
              <tr>
                {rows.map((r) => (
                  <th
                    key={`i-${r.codonIndex}`}
                    scope="col"
                    className={cn(
                      'min-w-[3.1rem] px-1 py-1 text-center text-[0.625rem] font-normal text-muted-foreground',
                      r.codonIndex === focusCodon && 'bg-signal-alarm/10 text-signal-alarm',
                    )}
                  >
                    {r.codonIndex}
                  </th>
                ))}
              </tr>
              <tr>
                {rows.map((r) => (
                  <td
                    key={`r-${r.codonIndex}`}
                    className={cn(
                      'seq px-1 py-1 text-center tracking-[0.08em]',
                      r.codonIndex === focusCodon && 'bg-signal-alarm/10',
                    )}
                  >
                    {r.refCodon === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      [0, 1, 2].map((i) => (
                        <span key={i} className={baseTone(r.refCodon, r.altCodon, i)}>
                          {r.refCodon?.[i] ?? ''}
                        </span>
                      ))
                    )}
                  </td>
                ))}
              </tr>
              <tr>
                {rows.map((r) => (
                  <td
                    key={`a-${r.codonIndex}`}
                    className={cn(
                      'seq px-1 py-1 text-center tracking-[0.08em]',
                      r.codonIndex === focusCodon && 'bg-signal-alarm/10',
                      r.status === 'changed' && !r.silent && 'bg-signal-alarm/15',
                      r.silent && 'bg-signal-warn/15',
                      r.status === 'added' && 'bg-signal-ok/15',
                      r.status === 'removed' && 'bg-muted',
                    )}
                  >
                    {r.altCodon === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      [0, 1, 2].map((i) => (
                        <span key={i} className={baseTone(r.refCodon, r.altCodon, i)}>
                          {r.altCodon?.[i] ?? ''}
                        </span>
                      ))
                    )}
                  </td>
                ))}
              </tr>
              <tr>
                {rows.map((r) => (
                  <td
                    key={`aa-${r.codonIndex}`}
                    className={cn(
                      'seq px-1 py-1 text-center',
                      r.codonIndex === focusCodon && 'bg-signal-alarm/10',
                    )}
                  >
                    {r.refAa === r.altAa ? (
                      <span className={r.silent ? 'text-signal-warn' : 'text-muted-foreground'}>
                        {r.refAa ?? '—'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 font-semibold text-signal-alarm">
                        {r.refAa ?? '—'}
                        <ArrowRight className="size-3.5" aria-hidden="true" />
                        {r.altAa ?? '—'}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-1.5 text-[0.625rem] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-signal-alarm/40" />
          amino-acid change
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-signal-warn/40" />
          silent (codon changed, amino acid did not)
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-signal-ok/40" />
          inserted
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm bg-muted" />
          deleted
        </span>
      </div>
    </div>
  );
}
