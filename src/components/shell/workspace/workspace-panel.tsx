'use client';

/**
 * The workspace: the tabbed right-hand column where every other surface
 * mounts.
 *
 * This file is the integration seam for the whole product. Three tabs render
 * components this thread owns (overview, diff, gene track, merge); two mount
 * components other threads own and that exist (`components/protein`,
 * `components/cell3d`); two declare mount points for components that do not
 * exist in this checkout yet (`components/genome-3d`,
 * `components/genome-upload`) and render a `MountSlot` stating the contract.
 *
 * Tabs are a hand-rolled ARIA tablist rather than the shadcn `tabs`
 * primitive, because the panels are expensive (a WebGL renderer, a structure
 * download) and must not all be mounted at once.
 */

import { useEffect, useState, useTransition } from 'react';
import {
  Activity,
  Atom,
  Columns3,
  Dna,
  GitMerge,
  Info,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { diffAction } from '@/app/actions';
import type {
  BranchSpec,
  BranchView,
  DiffView,
  LocusView,
  SimulationDefaultsView,
} from '../model/types';
import { DiffRegisters } from './diff-registers';
import { GeneTrack } from './gene-track';
import { MergeView } from './merge-view';
import { CellPanel } from './cell-panel';
import { ProteinPanel } from './protein-panel';
import { MountSlot } from './mount-slot';
import { StatusPill, toneForRun } from '../status';

export type WorkspaceTab =
  | 'overview'
  | 'diff'
  | 'track'
  | 'protein'
  | 'cell'
  | 'genome3d'
  | 'upload'
  | 'merge';

interface TabSpec {
  readonly id: WorkspaceTab;
  readonly label: string;
  readonly icon: LucideIcon;
}

export const WORKSPACE_TABS: readonly TabSpec[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'diff', label: 'Diff', icon: Columns3 },
  { id: 'track', label: 'Gene track', icon: Dna },
  { id: 'protein', label: 'Structure', icon: Atom },
  { id: 'cell', label: 'Cell flow', icon: Activity },
  { id: 'genome3d', label: 'Genome 3D', icon: Dna },
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'merge', label: 'Merge', icon: GitMerge },
];

export interface WorkspacePanelProps {
  readonly locus: LocusView;
  readonly branches: readonly BranchView[];
  readonly branch: BranchView;
  /** Replay list for branches the user created; the server needs it to see them. */
  readonly overlay: readonly BranchSpec[];
  readonly defaultBranch: string;
  readonly simulation: SimulationDefaultsView;
  readonly fixtureDisclaimer: string;
  readonly tab: WorkspaceTab;
  readonly onTabChange: (tab: WorkspaceTab) => void;
}

export function WorkspacePanel({
  locus,
  branches,
  branch,
  overlay,
  defaultBranch,
  simulation,
  fixtureDisclaimer,
  tab,
  onTabChange,
}: WorkspacePanelProps) {
  return (
    <>
      <div className="work__tabs" role="tablist" aria-label="Workspace views">
        {WORKSPACE_TABS.map((spec) => {
          const Icon = spec.icon;
          const selected = spec.id === tab;
          return (
            <button
              key={spec.id}
              type="button"
              role="tab"
              id={`tab-${spec.id}`}
              className="work__tab"
              aria-selected={selected}
              aria-controls={`panel-${spec.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onTabChange(spec.id)}
              onKeyDown={(event) => {
                // Left/Right move between tabs, as the tablist pattern expects.
                const delta =
                  event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                if (delta === 0) return;
                event.preventDefault();
                const i = WORKSPACE_TABS.findIndex((t) => t.id === tab);
                const next =
                  WORKSPACE_TABS[(i + delta + WORKSPACE_TABS.length) % WORKSPACE_TABS.length];
                if (next !== undefined) {
                  onTabChange(next.id);
                  document.getElementById(`tab-${next.id}`)?.focus();
                }
              }}
            >
              <Icon className="work__tab-icon" strokeWidth={1.75} aria-hidden="true" />
              {spec.label}
            </button>
          );
        })}
      </div>

      <div
        className="work__panel"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'overview' ? (
          <Overview
            locus={locus}
            branch={branch}
            fixtureDisclaimer={fixtureDisclaimer}
          />
        ) : null}

        {/* Keyed by branch: a branch switch remounts with empty state rather
            than resetting it from an effect. */}
        {tab === 'diff' ? (
          <DiffTab key={branch.name} branch={branch} overlay={overlay} />
        ) : null}

        {tab === 'track' ? (
          <div className="work__pad">
            <div className="work__section-head">
              <div>
                <h2 className="work__h font-display">Gene track</h2>
                <p className="work__sub">
                  {locus.gene} on chromosome {locus.chromosome}. Exons from the fixture;
                  the modelled window is the only region this app can diff or translate.
                  Zoom in to codon level to read the bases.
                </p>
              </div>
            </div>
            <GeneTrack locus={locus} edit={branch.tipEdit} />
          </div>
        ) : null}

        {tab === 'protein' ? <ProteinPanel branch={branch} /> : null}

        {tab === 'cell' ? <CellPanel branch={branch} simulation={simulation} /> : null}

        {/* ── Mount points for surfaces other threads own ───────────────── */}
        {tab === 'genome3d' ? (
          <div className="work__pad">
            <MountSlot
              title="Genome 3D"
              path="src/components/genome-3d/"
              purpose="A three-dimensional view of the locus under edit, sitting alongside the flat gene track."
              expects={[
                'locus: LocusView',
                'edit: EditView | null',
                'sequence: SequenceView  // the branch genotype',
                'reference: SequenceView',
              ]}
            />
          </div>
        ) : null}

        {tab === 'upload' ? (
          <div className="work__pad">
            <MountSlot
              title="Genome upload"
              path="src/components/genome-upload/"
              purpose="Bring a user-supplied sequence in as a new branch, so the diff and the pipeline can run against something other than the bundled fixture."
              expects={[
                'reference: SequenceView',
                'locus: LocusView',
                'onAccepted: (sequence: { bases: string; label: string }) => void',
              ]}
            />
            <p className="limitation">
              <TriangleAlert
                className="limitation__icon"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>
                When this lands, an uploaded sequence must still be screened by the gate
                before any downstream agent runs, and must be validated at the{' '}
                <span className="seq normal-case">Sequence</span> boundary — non-ACGT
                input is rejected with an error rather than silently truncated (SPEC
                §4.6 #13).
              </span>
            </p>
          </div>
        ) : null}

        {tab === 'merge' ? (
          <MergeView
            branches={branches}
            into={branch.name}
            overlay={overlay}
            defaultBranch={defaultBranch}
          />
        ) : null}
      </div>
    </>
  );
}

/** Loads the diff for the active branch from the server action. */
function DiffTab({
  branch,
  overlay,
}: {
  readonly branch: BranchView;
  readonly overlay: readonly BranchSpec[];
}) {
  const [diff, setDiff] = useState<DiffView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    startTransition(async () => {
      try {
        const next = await diffAction(branch.name, overlay);
        if (live) setDiff(next);
      } catch (cause) {
        if (live) {
          setError(cause instanceof Error ? cause.message : 'Could not load the diff.');
        }
      }
    });
    return () => {
      live = false;
    };
  }, [branch.name, overlay]);

  if (error !== null) {
    return (
      <div className="work__pad">
        <p className="work__sub status--failed" role="alert">
          {error}
        </p>
      </div>
    );
  }

  if (diff === null) {
    return (
      <div className="work__pad">
        <p className="work__sub" aria-live="polite">
          Aligning {branch.name} against the reference…
        </p>
      </div>
    );
  }

  if (diff.changedRows.length === 0) {
    return (
      <div className="work__pad">
        <div className="work__section-head">
          <div>
            <h2 className="work__h font-display">Diff</h2>
            <p className="work__sub">
              <strong className="font-medium">{branch.name}</strong> is the imported
              reference, so there is nothing to compare it against. Switch to a genotype
              line to see the three registers.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <DiffRegisters diff={diff} focusRow={diff.focusRow} />;
}

function Overview({
  locus,
  branch,
  fixtureDisclaimer,
}: {
  readonly locus: LocusView;
  readonly branch: BranchView;
  readonly fixtureDisclaimer: string;
}) {
  const tip = branch.commits[0];
  return (
    <div className="work__pad">
      <div className="work__section-head">
        <div>
          <h2 className="work__h font-display">{branch.name}</h2>
          <p className="work__sub">
            {branch.genotypeLabel ?? branch.tipEdit?.label ?? locus.reference.label}
          </p>
        </div>
        <StatusPill tone={toneForRun(branch.run)} />
      </div>

      <dl className="facts">
        <div className="facts__row">
          <dt className="facts__k">Locus</dt>
          <dd className="facts__v">
            {locus.gene} — {locus.name}
          </dd>
        </div>
        <div className="facts__row">
          <dt className="facts__k">Chromosome</dt>
          <dd className="facts__v">{locus.chromosome}</dd>
        </div>
        <div className="facts__row">
          <dt className="facts__k">Modelled region</dt>
          <dd className="facts__v">
            {locus.codonCount} codons / {locus.codonCount * 3} nt, from codon{' '}
            {locus.startCodon}
          </dd>
        </div>
        <div className="facts__row">
          <dt className="facts__k">Head</dt>
          <dd className="facts__v seq normal-case">{branch.shortHead}</dd>
        </div>
        <div className="facts__row">
          <dt className="facts__k">History</dt>
          <dd className="facts__v">
            {branch.commitCount} commit{branch.commitCount === 1 ? '' : 's'}
          </dd>
        </div>
        <div className="facts__row">
          <dt className="facts__k">Derived from</dt>
          <dd className="facts__v">{branch.origin}</dd>
        </div>
      </dl>

      <section aria-labelledby="overview-protein-heading">
        <h3
          className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground"
          id="overview-protein-heading"
        >
          Translation of this genotype
        </h3>
        <p className="seq hairline m-0 rounded-md border p-2.5 text-[0.8125rem] leading-relaxed">
          {branch.sequence.protein}
        </p>
      </section>

      {tip === undefined || tip.edit === null ? null : (
        <section aria-labelledby="overview-edit-heading">
          <h3
            className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground"
            id="overview-edit-heading"
          >
            Edit at the tip
          </h3>
          <dl className="facts">
            <div className="facts__row">
              <dt className="facts__k">Variant</dt>
              <dd className="facts__v">{tip.edit.label}</dd>
            </div>
            <div className="facts__row">
              <dt className="facts__k">Codon change</dt>
              <dd className="facts__v seq">
                {tip.edit.refCodon} → {tip.edit.altCodon} at {tip.edit.codonIndex}
              </dd>
            </div>
            <div className="facts__row">
              <dt className="facts__k">Kind</dt>
              <dd className="facts__v">{tip.edit.kind}</dd>
            </div>
          </dl>
        </section>
      )}

      <p className="limitation">
        <TriangleAlert className="limitation__icon" strokeWidth={1.75} aria-hidden="true" />
        <span>{fixtureDisclaimer}</span>
      </p>
    </div>
  );
}
