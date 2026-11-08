'use client';

/**
 * Instrument readouts for the live simulation: three arc gauges, a rolling
 * trace, and the text alternative that carries the same numbers for anyone
 * not reading the canvas.
 */

import { Activity, CircleDot, Droplets, Waves } from 'lucide-react';
import type { SimMetrics } from '@/lib/cellsim';
import { ArcGauge } from './arc-gauge';

export interface MetricSample {
  tick: number;
  occlusion: number;
  flowRatio: number;
  sickledFraction: number;
}

export interface ReadoutStripProps {
  metrics: SimMetrics;
  tick: number;
  baselineMeanFlow: number;
  history: readonly MetricSample[];
  genotypeLabel: string;
  pO2: number;
  pO2Unit: string;
  occlusionLimit: number;
  sickledLimit: number;
  flowFloor: number;
}

function tracePath(
  samples: readonly MetricSample[],
  pick: (s: MetricSample) => number,
  width: number,
  height: number,
): string {
  if (samples.length === 0) return '';
  const n = Math.max(2, samples.length);
  return samples
    .map((s, i) => {
      const x = (i / (n - 1)) * width;
      const y = height - Math.min(1, Math.max(0, pick(s))) * height;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

export function ReadoutStrip({
  metrics,
  tick,
  baselineMeanFlow,
  history,
  genotypeLabel,
  pO2,
  pO2Unit,
  occlusionLimit,
  sickledLimit,
  flowFloor,
}: ReadoutStripProps) {
  const flowRatio = baselineMeanFlow > 0 ? metrics.meanFlow / baselineMeanFlow : 0;
  const W = 300;
  const H = 54;

  return (
    <section aria-labelledby="readouts-heading" className="space-y-3">
      <h2
        id="readouts-heading"
        className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
      >
        <Activity className="size-3.5" aria-hidden="true" />
        Live readouts
      </h2>

      <div className="grid grid-cols-3 gap-2">
        <ArcGauge
          label="Occlusion"
          fraction={metrics.occlusion}
          reading={metrics.occlusion.toFixed(3)}
          dangerAbove={occlusionLimit}
          limitFraction={occlusionLimit}
          footnote={`limit ${occlusionLimit.toFixed(2)}`}
        />
        <ArcGauge
          label="Mean flow"
          fraction={Math.min(1, flowRatio)}
          reading={(flowRatio * 100).toFixed(1)}
          unit="% ref"
          dangerAbove={1.1}
          limitFraction={flowFloor}
          footnote={`floor ${(flowFloor * 100).toFixed(0)}%`}
        />
        <ArcGauge
          label="Sickled"
          fraction={metrics.sickledFraction}
          reading={(metrics.sickledFraction * 100).toFixed(1)}
          unit="%"
          dangerAbove={sickledLimit}
          limitFraction={sickledLimit}
          footnote={`limit ${(sickledLimit * 100).toFixed(0)}%`}
        />
      </div>

      <div className="recess-surface rounded-lg border border-bezel-edge/60 p-3">
        <div className="mb-1.5 flex items-center justify-between text-[0.625rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          <span className="flex items-center gap-1.5">
            <Waves className="size-3" aria-hidden="true" />
            Trace
          </span>
          <span className="tnum font-mono">t = {tick}</span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-14 w-full"
          aria-hidden="true"
        >
          <line
            x1={0}
            x2={W}
            y1={H / 2}
            y2={H / 2}
            stroke="currentColor"
            strokeWidth={0.5}
            className="text-foreground/15"
          />
          <path
            d={tracePath(history, (s) => s.flowRatio, W, H)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="text-signal"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={tracePath(history, (s) => s.occlusion, W, H)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="text-signal-alarm"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={tracePath(history, (s) => s.sickledFraction, W, H)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            strokeDasharray="3 2"
            className="text-signal-warn"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.625rem] text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <CircleDot className="size-3 text-signal" aria-hidden="true" />
            flow / reference
          </li>
          <li className="flex items-center gap-1.5">
            <CircleDot className="size-3 text-signal-alarm" aria-hidden="true" />
            occlusion
          </li>
          <li className="flex items-center gap-1.5">
            <Droplets className="size-3 text-signal-warn" aria-hidden="true" />
            sickled fraction
          </li>
        </ul>
      </div>

      {/* Text alternative for the canvas. */}
      <p aria-live="polite" className="sr-only">
        {`Capillary simulation, genotype ${genotypeLabel}, oxygen tension ${Math.round(pO2)} ${pO2Unit}, step ${tick}. ` +
          `Occlusion ${metrics.occlusion.toFixed(3)} of 1. ` +
          `Sickled fraction ${(metrics.sickledFraction * 100).toFixed(1)} percent. ` +
          `Mean flow ${(flowRatio * 100).toFixed(1)} percent of the reference allele. ` +
          `Illustrative model, not calibrated haemorheology.`}
      </p>
    </section>
  );
}
