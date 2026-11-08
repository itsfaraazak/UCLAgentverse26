'use client';

/**
 * The structural view: mounts `components/protein`'s viewer against the
 * branch's own variant id, so the residue it highlights is the one this
 * branch's commit actually edits.
 *
 * Lazy for the same reason as the cell panel — the viewer pulls a WebGPU /
 * WebGL renderer and a structure download, neither of which should block the
 * shell's first paint.
 */

import dynamic from 'next/dynamic';
import { TriangleAlert } from 'lucide-react';

import type { BranchView } from '../model/types';

const ProteinViewer = dynamic(
  () => import('@/components/protein').then((m) => ({ default: m.ProteinViewer })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[22rem] items-center justify-center text-[0.8125rem] text-muted-foreground">
        Loading the structure viewer…
      </div>
    ),
  },
);

export interface ProteinPanelProps {
  readonly branch: BranchView;
}

export function ProteinPanel({ branch }: ProteinPanelProps) {
  const edit = branch.tipEdit;

  return (
    <div className="work__pad">
      <div className="work__section-head">
        <div>
          <h2 className="work__h font-display">Structural consequence</h2>
          <p className="work__sub">
            The deposited structure around the edited residue. The position and the
            reference/alternate residues come from this branch&apos;s commit, not from the
            viewer&apos;s defaults.
          </p>
        </div>
      </div>

      {edit === null || edit.variantId === null ? (
        <p className="work__sub">
          <strong className="font-medium">{branch.name}</strong> carries the imported
          reference with no edit applied, so there is no substituted residue to show.
          Switch to a genotype line to see one.
        </p>
      ) : (
        <>
          <dl className="facts">
            <div className="facts__row">
              <dt className="facts__k">Variant</dt>
              <dd className="facts__v">{edit.label}</dd>
            </div>
            <div className="facts__row">
              <dt className="facts__k">Codon (CDS)</dt>
              <dd className="facts__v">{edit.codonIndex}</dd>
            </div>
            <div className="facts__row">
              <dt className="facts__k">Residue change</dt>
              <dd className="facts__v seq">
                {edit.refAa ?? '—'} → {edit.altAa ?? '—'}
              </dd>
            </div>
            {edit.proteinHgvs === null ? null : (
              <div className="facts__row">
                <dt className="facts__k">Protein HGVS</dt>
                <dd className="facts__v seq normal-case">{edit.proteinHgvs}</dd>
              </div>
            )}
            {edit.hgvs === null ? null : (
              <div className="facts__row">
                <dt className="facts__k">HGVS</dt>
                <dd className="facts__v seq normal-case">{edit.hgvs}</dd>
              </div>
            )}
            {edit.legacyName === null ? null : (
              <div className="facts__row">
                <dt className="facts__k">Legacy name</dt>
                <dd className="facts__v">{edit.legacyName}</dd>
              </div>
            )}
          </dl>

          {edit.numberingNote === null ? null : (
            <p className="limitation">
              <TriangleAlert
                className="limitation__icon"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>{edit.numberingNote}</span>
            </p>
          )}

          <div className="hairline overflow-hidden rounded-lg border">
            <ProteinViewer
              variantId={edit.variantId}
              codonIndex={edit.codonIndex}
              {...(edit.refAa === null ? {} : { refAa: edit.refAa })}
              {...(edit.altAa === null ? {} : { altAa: edit.altAa })}
              className="h-[26rem] w-full"
            />
          </div>
        </>
      )}
    </div>
  );
}
