import type { SimSnapshot } from '@/lib/cellsim';

/**
 * What the 3D cell view reports upward. Every number is read straight off a
 * `lib/cellsim` snapshot — the averaged `metrics()` window the simulation
 * itself maintains — never recomputed here.
 */
export interface CellFlowMetrics {
  readonly occlusion: number;
  readonly meanFlow: number;
  readonly sickledFraction: number;
  readonly tick: number;
  readonly pO2: number;
  readonly polymerizationTendency: number;
}

export function metricsFromSnapshot(snapshot: SimSnapshot): CellFlowMetrics {
  return {
    occlusion: snapshot.metrics.occlusion,
    meanFlow: snapshot.metrics.meanFlow,
    sickledFraction: snapshot.metrics.sickledFraction,
    tick: snapshot.tick,
    pO2: snapshot.params.pO2,
    polymerizationTendency: snapshot.params.polymerizationTendency,
  };
}

export type OcclusionBand = 'clear' | 'partial' | 'jammed';

/**
 * Display bands for this view only — chosen so the on-screen wording tracks
 * the picture. They are not clinical or physiological thresholds, and the UI
 * says so next to them.
 */
export const OCCLUSION_BANDS = { partial: 0.1, jammed: 0.4 } as const;

export function occlusionBand(occlusion: number): OcclusionBand {
  if (occlusion >= OCCLUSION_BANDS.jammed) return 'jammed';
  if (occlusion >= OCCLUSION_BANDS.partial) return 'partial';
  return 'clear';
}

export const BAND_TEXT: Record<OcclusionBand, string> = {
  clear: 'Constriction clear',
  partial: 'Constriction partly blocked by sickled cells',
  jammed: 'Constriction jammed by sickled cells',
};

export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function flow(value: number): string {
  return value.toFixed(2);
}
