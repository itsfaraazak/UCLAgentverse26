'use client';

/** A panel-mounted arc gauge. Pure presentation over a real metric value. */

import { cn } from 'cn';

export interface ArcGaugeProps {
  label: string;
  /** Normalised 0 → 1 position of the needle. */
  fraction: number;
  /** Formatted reading, e.g. "0.182" or "41.3%". */
  reading: string;
  unit?: string;
  /**
   * Which side of `limitFraction` is the alarm side. 'above' for metrics
   * where more is worse (occlusion, sickled fraction); 'below' for metrics
   * where less is worse (flow against its floor).
   */
  alarmWhen?: 'above' | 'below';
  /** Threshold marker, drawn as a red line on the scale. */
  limitFraction?: number;
  footnote?: string;
}

const R = 42;
const START = Math.PI * 0.8;
const SWEEP = Math.PI * 1.4;

function polar(fraction: number): { x: number; y: number } {
  const angle = START + SWEEP * Math.min(1, Math.max(0, fraction));
  return { x: 50 + R * Math.cos(angle), y: 50 + R * Math.sin(angle) };
}

function arcPath(from: number, to: number): string {
  const a = polar(from);
  const b = polar(to);
  const large = SWEEP * (to - from) > Math.PI ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export function ArcGauge({
  label,
  fraction,
  reading,
  unit,
  alarmWhen = 'above',
  limitFraction,
  footnote,
}: ArcGaugeProps) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const alarm =
    limitFraction !== undefined &&
    (alarmWhen === 'above' ? clamped > limitFraction : clamped < limitFraction);
  const needle = polar(clamped);

  return (
    <div className="bezel-surface flex flex-col items-center gap-1 rounded-lg border border-border px-3 py-3">
      <svg viewBox="0 0 100 72" className="w-full max-w-[150px]" role="img" aria-hidden="true">
        <path
          d={arcPath(0, 1)}
          fill="none"
          stroke="currentColor"
          className="text-foreground/15"
          strokeWidth={7}
          strokeLinecap="round"
        />
        {clamped > 0.001 ? (
          <path
            d={arcPath(0, clamped)}
            fill="none"
            stroke="currentColor"
            className={alarm ? 'text-signal-alarm' : 'text-signal'}
            strokeWidth={7}
            strokeLinecap="round"
          />
        ) : null}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const outer = polar(t);
          const inner = {
            x: 50 + (R - 11) * Math.cos(START + SWEEP * t),
            y: 50 + (R - 11) * Math.sin(START + SWEEP * t),
          };
          return (
            <line
              key={t}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="currentColor"
              strokeWidth={0.8}
              className="text-foreground/35"
            />
          );
        })}
        {limitFraction !== undefined ? (
          <line
            x1={50 + (R - 13) * Math.cos(START + SWEEP * limitFraction)}
            y1={50 + (R - 13) * Math.sin(START + SWEEP * limitFraction)}
            x2={polar(limitFraction).x}
            y2={polar(limitFraction).y}
            stroke="currentColor"
            strokeWidth={2}
            className="text-signal-alarm"
          />
        ) : null}
        <line
          x1={50}
          y1={50}
          x2={needle.x}
          y2={needle.y}
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          className="text-foreground/70"
        />
        <circle cx={50} cy={50} r={3} className="fill-foreground/70" />
      </svg>
      <div
        className={cn(
          'tnum font-mono text-xl leading-none font-semibold',
          alarm ? 'text-signal-alarm' : 'text-foreground',
        )}
      >
        {reading}
        {unit !== undefined ? (
          <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>
        ) : null}
      </div>
      <div className="text-center text-[0.625rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </div>
      {footnote !== undefined ? (
        <div className="tnum text-center font-mono text-[0.625rem] text-muted-foreground">
          {footnote}
        </div>
      ) : null}
    </div>
  );
}
