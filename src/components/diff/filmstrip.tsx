'use client';

/**
 * The diff as a filmstrip: reference → mutant → repaired as selectable
 * frames. Selecting a frame reconfigures the canvas, the readouts, the gene
 * track marker and the registers below.
 */

import { useState } from 'react';
import { ArrowRight, Film, GitBranch, Images, ScanLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from 'cn';
import type { FrameView } from '@/app/bench/bench-types';
import { Registers } from './registers';

export interface FilmstripProps {
  frames: readonly FrameView[];
  selectedId: string;
  onSelect: (id: string) => void;
}

type Basis = 'reference' | 'previous';

export function Filmstrip({ frames, selectedId, onSelect }: FilmstripProps) {
  const [basis, setBasis] = useState<Basis>('reference');
  const selected = frames.find((f) => f.id === selectedId) ?? frames[0];
  const usePrevious = basis === 'previous' && selected.previousLabel !== null;
  const rows = usePrevious ? selected.diffFromPrevious : selected.diff;
  const refLabel = usePrevious ? (selected.previousLabel ?? 'previous') : 'HbA reference';

  return (
    <section aria-labelledby="filmstrip-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="filmstrip-heading"
          className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
        >
          <Film className="size-3.5" aria-hidden="true" />
          Edit filmstrip
        </h2>
        <ToggleGroup
          value={[basis]}
          onValueChange={(next) => {
            const first = Array.isArray(next) ? next[0] : next;
            if (first === 'reference' || first === 'previous') setBasis(first);
          }}
          aria-label="Diff basis"
        >
          <ToggleGroupItem value="reference" aria-label="Diff against the reference allele">
            <ScanLine className="size-3.5" aria-hidden="true" />
            vs reference
          </ToggleGroupItem>
          <ToggleGroupItem value="previous" aria-label="Diff against the previous frame">
            <Images className="size-3.5" aria-hidden="true" />
            vs previous frame
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* The strip itself, with sprocket perforations. */}
      <div className="recess-surface rounded-lg p-2">
        <div
          aria-hidden="true"
          className="mx-1 mb-2 flex justify-between opacity-55"
          style={{ height: 6 }}
        >
          {Array.from({ length: 28 }, (_, i) => (
            <span key={i} className="h-1.5 w-2.5 rounded-sm bg-foreground/25" />
          ))}
        </div>

        <ToggleGroup
          value={[selectedId]}
          onValueChange={(next) => {
            const first = Array.isArray(next) ? next[0] : next;
            if (typeof first === 'string' && first.length > 0) onSelect(first);
          }}
          aria-label="Filmstrip frame"
          className="grid w-full grid-cols-1 gap-2 bg-transparent p-0 sm:grid-cols-3"
        >
          {frames.map((frame, i) => {
            const active = frame.id === selectedId;
            const change =
              frame.structural === null
                ? null
                : {
                    refAa: frame.structural.refAa,
                    altAa: frame.structural.altAa,
                    refAaName: frame.structural.refAaName,
                    altAaName: frame.structural.altAaName,
                  };
            const edited = frame.diffFromPrevious.find((r) => r.status === 'changed') ?? null;

            return (
              <ToggleGroupItem
                key={frame.id}
                value={frame.id}
                aria-label={`Frame ${i + 1}: ${frame.label}`}
                className={cn(
                  'h-auto w-full flex-col items-stretch gap-2 rounded-lg border p-3 text-left',
                  active
                    ? 'border-signal bg-signal/10'
                    : 'border-border bg-card hover:bg-muted/60',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="tnum font-mono text-[0.625rem] text-muted-foreground">
                    FRAME {String(i + 1).padStart(2, '0')}
                  </span>
                  <Badge variant={active ? 'default' : 'outline'}>{frame.role}</Badge>
                </span>

                <span className="text-sm font-semibold">{frame.label}</span>

                <span className="flex items-center gap-1.5 text-[0.625rem] text-muted-foreground">
                  <GitBranch className="size-3.5" aria-hidden="true" />
                  <span className="tnum font-mono">{frame.branch}</span>
                  <span className="tnum font-mono opacity-70">{frame.shortOid}</span>
                </span>

                <span className="tnum flex items-center gap-2 rounded-md bg-background/70 px-2 py-1.5 seq text-xs">
                  {edited === null || change === null ? (
                    <span className="text-muted-foreground">
                      {frame.role === 'reference'
                        ? 'reference codons, no edit'
                        : 'identical to previous frame'}
                    </span>
                  ) : (
                    <>
                      <span className="text-muted-foreground">c.{edited.codonIndex}</span>
                      <span className="seq">{edited.refCodon}</span>
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                      <span className="seq font-semibold text-signal-alarm">{edited.altCodon}</span>
                      <span className="seq ml-auto inline-flex items-center">
                        {change.refAa}
                        <ArrowRight className="mx-0.5 size-3.5" aria-hidden="true" />
                        {change.altAa}
                      </span>
                    </>
                  )}
                </span>

                <span className="space-y-1">
                  <span className="flex justify-between text-[0.625rem] text-muted-foreground">
                    <span>polymerization tendency</span>
                    <span className="tnum font-mono">
                      {frame.polymerizationTendency.toFixed(2)}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="block h-1.5 w-full overflow-hidden rounded-full bg-background/80"
                  >
                    <span
                      className={cn(
                        'block h-full rounded-full',
                        frame.polymerizationTendency > 0.5 ? 'bg-signal-alarm' : 'bg-signal-ok',
                      )}
                      style={{ width: `${frame.polymerizationTendency * 100}%` }}
                    />
                  </span>
                </span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>

        <div
          aria-hidden="true"
          className="mx-1 mt-2 flex justify-between opacity-55"
          style={{ height: 6 }}
        >
          {Array.from({ length: 28 }, (_, i) => (
            <span key={i} className="h-1.5 w-2.5 rounded-sm bg-foreground/25" />
          ))}
        </div>
      </div>

      <Registers
        rows={rows}
        refLabel={refLabel}
        altLabel={selected.label}
        focusCodon={selected.changedCodonIndex}
      />

      {selected.structural !== null ? (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{selected.variantLabel}</Badge>
            {selected.hgvs !== null ? (
              <span className="tnum font-mono text-[0.6875rem] text-muted-foreground">
                {selected.hgvs}
              </span>
            ) : null}
            {selected.proteinHgvs !== null ? (
              <span className="tnum font-mono text-[0.6875rem] text-muted-foreground">
                {selected.proteinHgvs}
              </span>
            ) : null}
            {selected.legacyName !== null ? (
              <span className="tnum font-mono text-[0.6875rem] text-muted-foreground">
                legacy {selected.legacyName}
              </span>
            ) : null}
            <Badge variant="outline">{selected.provenance}</Badge>
          </div>
          <p className="mt-2 text-xs">
            <span className="font-semibold">{selected.structural.refAaName}</span>
            <ArrowRight className="mx-1 inline size-3.5" aria-hidden="true" />
            <span className="font-semibold">{selected.structural.altAaName}</span> —{' '}
            {selected.structural.summary}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {selected.structural.consequence}
          </p>
          {selected.numberingNote !== null ? (
            <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">
              {selected.numberingNote}
            </p>
          ) : null}
          <p className="mt-1.5 text-[0.6875rem] text-muted-foreground italic">
            Annotation confidence: {selected.structural.confidence}. {selected.structural.limitation}
          </p>
        </div>
      ) : null}
    </section>
  );
}
