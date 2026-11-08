'use client';

/**
 * The branch rail.
 *
 * Every row here is a real ref from `lib/vcs`, seeded from `data/loci.json` —
 * there is no branch list in this file. Each row's status comes from that
 * branch's tip check run, which is a `runPipeline()` result, and the commit
 * count is the length of its history.
 *
 * Row metrics (2.125rem, 0.875rem text, 1px gaps, transparent background with
 * a subtle colour-mix hover) are carried over from the reference dashboard's
 * sidebar, which is what keeps a dense list calm.
 */

import { Dna, GitBranch, Microscope } from 'lucide-react';

import type { BranchView, LocusView } from './model/types';
import { StatusMark, statusLabel, toneForRun } from './status';

export interface BranchRailProps {
  readonly locus: LocusView;
  readonly branches: readonly BranchView[];
  readonly current: string;
  readonly collapsed: boolean;
  readonly onSelect: (branch: string) => void;
}

export function BranchRail({
  locus,
  branches,
  current,
  collapsed,
  onSelect,
}: BranchRailProps) {
  return (
    <>
      <section className="rail__section" aria-labelledby="rail-locus-heading">
        <h2 className="rail__heading" id="rail-locus-heading">
          <span>Locus</span>
        </h2>
        <div
          className="row"
          // Not interactive: the locus is the repository, and this prototype
          // carries one. Rendered as a row for rhythm, not as a dead button.
          role="presentation"
        >
          <Microscope className="row__icon" strokeWidth={1.75} aria-hidden="true" />
          <span className="row__label" title={`${locus.name} · chromosome ${locus.chromosome}`}>
            {locus.gene}
          </span>
          <span className="row__meta">chr{locus.chromosome}</span>
        </div>
        <p className="rail__hide-collapsed px-2 pt-1 text-[0.6875rem] leading-relaxed text-muted-foreground">
          {locus.codonCount} codons / {locus.codonCount * 3} nt modelled, from{' '}
          {locus.provenance.replace(/-/g, ' ')} fixture data.
        </p>
      </section>

      <hr className="rail__rule" />

      <section className="rail__section" aria-labelledby="rail-branch-heading">
        <h2 className="rail__heading" id="rail-branch-heading">
          <span>Genotype lines</span>
          <span className="rail__hide-collapsed font-normal tracking-normal normal-case">
            {branches.length}
          </span>
        </h2>

        <ul className="contents" role="list">
          {branches.map((branch) => {
            const isCurrent = branch.name === current;
            const tone = toneForRun(branch.run);
            const Icon = branch.isDefault ? Dna : GitBranch;
            return (
              <li key={branch.name} className="contents">
                <button
                  type="button"
                  className="row branch-row"
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => onSelect(branch.name)}
                  title={
                    collapsed
                      ? `${branch.name} — ${statusLabel(tone)}`
                      : `${branch.origin}\nHead ${branch.shortHead} — ${statusLabel(tone)}`
                  }
                >
                  <Icon
                    className="row__icon mt-[0.1875rem]"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span className="branch-row__text">
                    <span className="row__label">{branch.name}</span>
                    <span className="branch-row__sub">
                      {branch.genotypeLabel ?? branch.tipEdit?.label ?? 'reference'} ·{' '}
                      {branch.commitCount} commit{branch.commitCount === 1 ? '' : 's'}
                    </span>
                  </span>
                  {/* Dot + icon always; the word only when the rail is wide
                      enough. Collapsed, the icon still carries the state, so
                      colour is never the sole signal. */}
                  <StatusMark
                    tone={tone}
                    labelled={false}
                    label={`${branch.name}: ${statusLabel(tone)}`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <hr className="rail__rule" />

      <section className="rail__section rail__hide-collapsed" aria-labelledby="rail-head-heading">
        <h2 className="rail__heading" id="rail-head-heading">
          <span>Head commit</span>
        </h2>
        <HeadSummary branches={branches} current={current} />
      </section>
    </>
  );
}

function HeadSummary({
  branches,
  current,
}: {
  readonly branches: readonly BranchView[];
  readonly current: string;
}) {
  const branch = branches.find((b) => b.name === current);
  if (branch === undefined) return null;
  const tip = branch.commits[0];
  if (tip === undefined) return null;

  return (
    <dl className="flex flex-col gap-2 px-2 pb-1 text-[0.75rem]">
      <div className="flex flex-col gap-0.5">
        <dt className="text-[0.6875rem] uppercase tracking-[0.04em] text-muted-foreground">
          Object id
        </dt>
        <dd className="seq m-0 text-[0.75rem]">{tip.short}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-[0.6875rem] uppercase tracking-[0.04em] text-muted-foreground">
          Message
        </dt>
        <dd className="m-0 leading-snug">{tip.message}</dd>
      </div>
      {tip.edit === null ? null : (
        <div className="flex flex-col gap-0.5">
          <dt className="text-[0.6875rem] uppercase tracking-[0.04em] text-muted-foreground">
            Edit
          </dt>
          <dd className="m-0 leading-snug">
            <span className="seq">
              {tip.edit.refCodon} → {tip.edit.altCodon}
            </span>{' '}
            at codon {tip.edit.codonIndex}
            {tip.edit.refAa === null || tip.edit.altAa === null ? null : (
              <>
                {', '}
                <span className="seq">
                  {tip.edit.refAa} → {tip.edit.altAa}
                </span>
              </>
            )}
          </dd>
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        <dt className="text-[0.6875rem] uppercase tracking-[0.04em] text-muted-foreground">
          Derived from
        </dt>
        <dd className="m-0 leading-snug text-muted-foreground">{branch.origin}</dd>
      </div>
    </dl>
  );
}
