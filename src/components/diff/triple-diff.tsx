'use client';

import { useMemo, useState } from 'react';
import { ArrowLeftRight, Columns3, Dot } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import type { DiffView } from '@/lib/demo/view';
import type { DiffRow } from '@/lib/genome';

export interface TripleDiffProps {
  readonly diff: DiffView;
}

const STATUS_STYLE: Readonly<Record<DiffRow['status'], string>> = {
  same: '',
  changed: 'bg-escalate-soft/50',
  added: 'bg-pass-soft/50',
  removed: 'bg-block-soft/50',
};

/**
 * Side-by-side diff across three synchronised registers — DNA, codon and
 * amino acid (SPEC §5). One row per aligned codon, so the three registers
 * cannot drift out of step: they are literally three columns of the same row.
 */
export function TripleDiff({ diff }: TripleDiffProps) {
  const [onlyChanges, setOnlyChanges] = useState(false);

  const rows = useMemo(
    () => (onlyChanges ? diff.rows.filter((row) => row.status !== 'same') : diff.rows),
    [diff.rows, onlyChanges],
  );

  const silentCount = diff.rows.filter((row) => row.silent).length;
  const changedCount = diff.rows.filter((row) => row.status !== 'same').length;

  return (
    <section className="flex flex-col gap-3" aria-label="Sequence diff">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Columns3 className="size-4 text-muted-foreground" aria-hidden="true" />
          Diff
        </h3>
        <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <span className="truncate font-mono">{diff.refLabel}</span>
          <ArrowLeftRight className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate font-mono">{diff.altLabel}</span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor="only-changes" className="text-[11.5px] text-muted-foreground">
            Changes only
          </Label>
          <Switch
            id="only-changes"
            checked={onlyChanges}
            onCheckedChange={setOnlyChanges}
            aria-label="Show changed codons only"
          />
        </div>
      </header>

      <p className="text-[11.5px] text-muted-foreground tnum">
        {changedCount === 0
          ? 'No differences — the two genotypes are identical.'
          : `${changedCount} of ${diff.rows.length} codons differ` +
            (silentCount > 0
              ? `, ${silentCount} of them synonymous (DNA changed, amino acid did not).`
              : '.')}
      </p>

      <div className="hairline overflow-hidden rounded-lg border">
        <div className="max-h-[22rem] overflow-auto">
          <table className="w-full border-collapse text-left text-[11.5px]">
            <caption className="sr-only">
              Codon-by-codon diff of {diff.refLabel} against {diff.altLabel}, in three
              synchronised registers: DNA bases, codon index, and amino acid.
            </caption>
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                <th scope="col" className="px-2.5 py-2">
                  Codon
                </th>
                <th scope="col" className="px-2.5 py-2">
                  DNA ref
                </th>
                <th scope="col" className="px-2.5 py-2">
                  DNA alt
                </th>
                <th scope="col" className="px-2.5 py-2">
                  AA ref
                </th>
                <th scope="col" className="px-2.5 py-2">
                  AA alt
                </th>
                <th scope="col" className="px-2.5 py-2">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.codonIndex}
                  className={`border-b border-border/50 last:border-0 ${STATUS_STYLE[row.status]}`}
                >
                  <td className="px-2.5 py-1.5 text-muted-foreground tnum">{row.codonIndex}</td>
                  <td className="seq px-2.5 py-1.5">
                    <Bases codon={row.refCodon} other={row.altCodon} />
                  </td>
                  <td className="seq px-2.5 py-1.5">
                    <Bases codon={row.altCodon} other={row.refCodon} />
                  </td>
                  <td className="seq px-2.5 py-1.5">{row.refAa ?? '–'}</td>
                  <td
                    className={`seq px-2.5 py-1.5 ${
                      row.status === 'changed' && !row.silent ? 'font-semibold text-block' : ''
                    }`}
                  >
                    {row.altAa ?? '–'}
                  </td>
                  <td className="px-2.5 py-1.5">
                    {row.status === 'same' ? (
                      <Dot className="size-3.5 text-muted-foreground/50" aria-label="unchanged" />
                    ) : (
                      <span className="text-[10px] font-semibold tracking-wide uppercase">
                        {row.silent ? 'synonymous' : row.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2.5 py-6 text-center text-muted-foreground">
                    No changed codons.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** Highlights only the bases that differ from the paired codon. */
function Bases({ codon, other }: { readonly codon: string | null; readonly other: string | null }) {
  if (codon === null) return <span className="text-muted-foreground">———</span>;
  return (
    <span>
      {codon.split('').map((base, index) => {
        const differs = other === null || other.charAt(index) !== base;
        return (
          <span key={index} className={differs ? 'font-semibold text-block underline' : undefined}>
            {base}
          </span>
        );
      })}
    </span>
  );
}
