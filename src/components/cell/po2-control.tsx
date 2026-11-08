'use client';

/**
 * The primary interaction of the whole app: oxygen tension.
 *
 * A recessed, physical-feeling slider with a milled thumb, a measured scale
 * and a hypoxia band below the sickling onset. Built on the shadcn Slider so
 * it keeps keyboard support, roles and focus handling.
 */

import { Gauge, Minus, Plus, Wind } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from 'cn';

export interface PO2ControlProps {
  value: number;
  min: number;
  max: number;
  unit: string;
  label: string;
  onsetBelow: number;
  onChange: (value: number) => void;
}

export function PO2Control({
  value,
  min,
  max,
  unit,
  label,
  onsetBelow,
  onChange,
}: PO2ControlProps) {
  const span = max - min;
  const onsetPct = ((onsetBelow - min) / span) * 100;
  const hypoxic = value < onsetBelow;
  const ticks = Array.from({ length: 10 }, (_, i) => min + (span / 9) * i);

  const nudge = (delta: number) => {
    onChange(Math.min(max, Math.max(min, value + delta)));
  };

  return (
    <section
      aria-labelledby="po2-control-heading"
      className="recess-surface rounded-xl border border-bezel-edge/70 p-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <Label
            id="po2-control-heading"
            htmlFor="po2-slider"
            className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
          >
            <Gauge className="size-3.5" aria-hidden="true" />
            {label}
          </Label>
          <p className="text-xs text-muted-foreground">
            Primary control. Drop below {onsetBelow} {unit} to drive deoxygenation.
          </p>
        </div>

        <div className="flex items-end gap-3">
          <div
            className={cn(
              'tnum font-mono leading-none tracking-tight',
              hypoxic ? 'text-signal-alarm' : 'text-signal',
            )}
          >
            <span className="text-6xl font-semibold">{Math.round(value)}</span>
            <span className="ml-2 text-base text-muted-foreground">{unit}</span>
          </div>
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={`Increase ${label} by 5 ${unit}`}
              onClick={() => nudge(5)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={`Decrease ${label} by 5 ${unit}`}
              onClick={() => nudge(-5)}
            >
              <Minus className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      <div className="relative mt-5">
        {/* Hypoxia band: the region where polymerization is favoured. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-1 bottom-6 left-0 rounded-l-md bg-signal-alarm/12 ring-1 ring-signal-alarm/25 ring-inset"
          style={{ width: `${onsetPct}%` }}
        />
        <Slider
          id="po2-slider"
          min={min}
          max={max}
          step={1}
          value={[value]}
          aria-label={`${label} in ${unit}`}
          onValueChange={(next) => {
            const v = Array.isArray(next) ? next[0] : next;
            if (typeof v === 'number') onChange(v);
          }}
          className={cn(
            'relative',
            '[&_[data-slot=slider-track]]:h-3 [&_[data-slot=slider-track]]:rounded-full',
            '[&_[data-slot=slider-track]]:bg-background/80 [&_[data-slot=slider-track]]:shadow-[inset_0_1px_3px_rgba(0,0,0,0.45)]',
            '[&_[data-slot=slider-range]]:bg-gradient-to-r',
            hypoxic
              ? '[&_[data-slot=slider-range]]:from-signal-alarm/70 [&_[data-slot=slider-range]]:to-signal-alarm'
              : '[&_[data-slot=slider-range]]:from-signal/60 [&_[data-slot=slider-range]]:to-signal',
            '[&_[data-slot=slider-thumb]]:size-7 [&_[data-slot=slider-thumb]]:bg-gradient-to-b',
            '[&_[data-slot=slider-thumb]]:from-bezel [&_[data-slot=slider-thumb]]:to-bezel-edge',
            '[&_[data-slot=slider-thumb]]:border-2 [&_[data-slot=slider-thumb]]:border-foreground/25',
            '[&_[data-slot=slider-thumb]]:shadow-[0_2px_6px_rgba(0,0,0,0.45)]',
          )}
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 100 10"
          preserveAspectRatio="none"
          className="mt-2 h-5 w-full overflow-visible"
        >
          {ticks.map((t, i) => {
            const x = ((t - min) / span) * 100;
            return (
              <g key={t}>
                <line
                  x1={x}
                  x2={x}
                  y1={0}
                  y2={i % 3 === 0 ? 4 : 2.5}
                  stroke="currentColor"
                  strokeWidth={0.3}
                  className="text-muted-foreground"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>
        <div className="tnum -mt-3 flex justify-between font-mono text-[0.625rem] text-muted-foreground">
          {ticks
            .filter((_, i) => i % 3 === 0)
            .map((t) => (
              <span key={t}>{Math.round(t)}</span>
            ))}
        </div>
      </div>

      <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
        <Wind className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {hypoxic
            ? `Hypoxic: below the ${onsetBelow} ${unit} onset used by the model, so sickling is favoured.`
            : `Normoxic: above the ${onsetBelow} ${unit} onset used by the model.`}
        </span>
      </p>
    </section>
  );
}
