export type CellShape = 'discoid' | 'sickled';

export interface Cell {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly radius: number;
  readonly state: CellShape;
  readonly theta: number;
}

export interface SimParams {
  readonly seed: number;
  readonly cellCount: number;
  readonly pO2: number;
  readonly polymerizationTendency: number;
  readonly capillaryConstriction: number;
}

export interface SimMetrics {
  readonly occlusion: number;
  readonly meanFlow: number;
  readonly sickledFraction: number;
}

export interface ChannelGeom {
  readonly width: number;
  readonly height: number;
  readonly constrictionX: number;
  readonly constrictionHalfLength: number;
  readonly opening: number;
}

export interface SimSnapshot {
  readonly tick: number;
  readonly params: SimParams;
  readonly geom: ChannelGeom;
  readonly cells: readonly Cell[];
  readonly metrics: SimMetrics;
}

export interface AssayInput {
  readonly polymerizationTendency: number;
  readonly pO2?: number;
  readonly seed?: number;
  readonly cellCount?: number;
  readonly capillaryConstriction?: number;
  readonly steps?: number;
}
