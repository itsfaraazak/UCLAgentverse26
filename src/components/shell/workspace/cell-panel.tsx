'use client';

/**
 * The live cell view: mounts `components/cell3d`'s renderer and drives it with
 * the branch's own `polymerizationTendency` from `data/loci.json`, plus a pO₂
 * slider.
 *
 * The renderer is loaded lazily because it pulls in Three.js, which has no
 * business in the shell's first paint. Metrics come back from the simulation
 * itself via `onMetrics` — this panel computes none of them.
 */

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { Gauge, TriangleAlert } from 'lucide-react';

import type { CellFlowMetrics } from '@/components/cell3d';
import type { BranchView, SimulationDefaultsView } from '../model/types';

const CellFlow3D = dynamic(
  () => import('@/components/cell3d').then((m) => ({ default: m.CellFlow3D })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[22rem] items-center justify-center text-[0.8125rem] text-muted-foreground">
        Loading the simulation renderer…
      </div>
    ),
  },
);

export interface CellPanelProps {
  readonly branch: BranchView;
  readonly simulation: SimulationDefaultsView;
}

export function CellPanel({ branch, simulation }: CellPanelProps) {
  const [pO2, setPO2] = useState(simulation.pO2);
  const [metrics, setMetrics] = useState<CellFlowMetrics | null>(null);

  const onMetrics = useCallback((next: CellFlowMetrics) => {
    setMetrics(next);
  }, []);

  const tendency = branch.polymerizationTendency;

  return (
    <div className="work__pad">
      <div className="work__section-head">
        <div>
          <h2 className="work__h font-display">Functional assay</h2>
          <p className="work__sub">
            The same deterministic simulation the pipeline&apos;s functional-assay agent
            calls headless, driven here by{' '}
            <strong className="font-medium">{branch.name}</strong>&apos;s genotype.
            Drop pO₂ to see the genotypes diverge.
          </p>
        </div>
      </div>

      {tendency === null ? (
        <p className="work__sub">
          This line has no genotype in <span className="seq normal-case">loci.json</span>,
          so there is no polymerization tendency to drive the simulation with.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
              <label
                className="flex items-baseline justify-between text-[0.75rem] font-medium"
                htmlFor="po2"
              >
                <span>Oxygen tension (pO₂)</span>
                <span className="seq text-[0.8125rem] normal-case tabular-nums">
                  {pO2} mmHg
                </span>
              </label>
              <input
                id="po2"
                type="range"
                min={simulation.pO2Min}
                max={simulation.pO2Max}
                step={1}
                value={pO2}
                onChange={(event) => setPO2(Number(event.currentTarget.value))}
                className="w-full accent-[var(--primary)]"
                aria-describedby="po2-help"
              />
              <p id="po2-help" className="m-0 text-[0.6875rem] text-muted-foreground">
                Range {simulation.pO2Min}–{simulation.pO2Max} mmHg, from the fixture.
                Seed {simulation.seed}, {simulation.cellCount} cells.
              </p>
            </div>

            <dl className="metrics min-w-[18rem] flex-1">
              <div className="metric">
                <dt className="metric__k">Occlusion</dt>
                <dd className="metric__v m-0">
                  {metrics === null ? '—' : metrics.occlusion.toFixed(3)}
                </dd>
                <dd className="metric__note m-0">pathological blockage, 0–1</dd>
              </div>
              <div className="metric">
                <dt className="metric__k">Mean flow</dt>
                <dd className="metric__v m-0">
                  {metrics === null ? '—' : metrics.meanFlow.toFixed(3)}
                </dd>
                <dd className="metric__note m-0">arbitrary units</dd>
              </div>
              <div className="metric">
                <dt className="metric__k">Sickled</dt>
                <dd className="metric__v m-0">
                  {metrics === null ? '—' : `${(metrics.sickledFraction * 100).toFixed(1)}%`}
                </dd>
                <dd className="metric__note m-0">of {simulation.cellCount} cells</dd>
              </div>
              <div className="metric">
                <dt className="metric__k">
                  <span className="inline-flex items-center gap-1">
                    <Gauge className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
                    Tendency
                  </span>
                </dt>
                <dd className="metric__v m-0">{tendency.toFixed(2)}</dd>
                <dd className="metric__note m-0">
                  {branch.genotypeLabel ?? branch.name}
                </dd>
              </div>
            </dl>
          </div>

          <div className="hairline overflow-hidden rounded-lg border">
            <CellFlow3D
              pO2={pO2}
              polymerizationTendency={tendency}
              seed={simulation.seed}
              cellCount={simulation.cellCount}
              capillaryConstriction={simulation.capillaryConstriction}
              onMetrics={onMetrics}
              className="h-[24rem] w-full"
            />
          </div>

          <p className="limitation">
            <TriangleAlert className="limitation__icon" strokeWidth={1.75} aria-hidden="true" />
            <span>{simulation.assayLimitation}</span>
          </p>
        </>
      )}
    </div>
  );
}
