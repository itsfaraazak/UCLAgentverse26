'use client';

/**
 * The Genome 3D tab: mounts `components/genome-3d`'s helix against the
 * active branch's own genotype.
 *
 * `helixSourceFor` decides what is drawn — see `genome-source.ts` for why the
 * tip variant id alone is not enough. This file only renders the choice.
 *
 * `GenomeHelix3D` is imported statically on purpose. It prerenders its full
 * text alternative and pulls `three` in through its own dynamic `import()`
 * after mount, so the shell stays statically prerenderable without
 * `next/dynamic`, and the component's own loading, failure and retry states
 * are the ones the user sees.
 */

import { useMemo } from 'react';
import { TriangleAlert } from 'lucide-react';

import { GenomeHelix3D } from '@/components/genome-3d';
import type { BranchView, LocusView } from '../model/types';
import { helixSourceFor } from './genome-source';

export interface GenomePanelProps {
  readonly locus: LocusView;
  readonly branch: BranchView;
}

export function GenomePanel({ locus, branch }: GenomePanelProps) {
  const source = useMemo(() => helixSourceFor(locus, branch), [locus, branch]);

  return (
    <div className="work__pad">
      <div className="work__section-head">
        <div>
          <h2 className="work__h font-display">Genome 3D</h2>
          <p className="work__sub">
            <strong className="font-medium">{branch.name}</strong>{' '}
            {source.kind === 'curated' ? (
              <>
                applies one curated edit to the reference, drawn from its{' '}
                <span className="seq normal-case">data/loci.json</span> entry with that
                entry&apos;s annotation.
              </>
            ) : source.kind === 'net' && source.editCount === 0 ? (
              <>
                is the imported reference with no edit applied, so no codon is marked.
              </>
            ) : source.kind === 'net' ? (
              <>
                carries {source.editCount} edit{source.editCount === 1 ? '' : 's'} in its
                history. It is drawn as its net change from the reference — the
                branch&apos;s own bases against the reference allele — so no single curated
                annotation applies.
              </>
            ) : (
              <>could not be drawn.</>
            )}
          </p>
        </div>
      </div>

      {source.kind === 'unavailable' ? (
        <p className="limitation" role="alert">
          <TriangleAlert className="limitation__icon" strokeWidth={1.75} aria-hidden="true" />
          <span>{source.detail}</span>
        </p>
      ) : (
        <div className="hairline rounded-lg border p-3">
          {source.kind === 'curated' ? (
            <GenomeHelix3D gene={source.gene} variantId={source.variantId} />
          ) : (
            <GenomeHelix3D model={source.model} />
          )}
        </div>
      )}
    </div>
  );
}
