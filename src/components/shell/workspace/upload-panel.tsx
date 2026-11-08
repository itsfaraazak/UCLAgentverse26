'use client';

/**
 * The Upload tab: mounts `components/genome-upload` and, once an upload has
 * been screened, validated and accepted, draws it with `components/genome-3d`.
 *
 * What this deliberately does not do: turn the upload into a branch. A branch
 * in this shell is replayed on the server from a `BranchSpec`, whose edit is a
 * curated variant id — that is what lets the server run the seven-agent
 * pipeline on it and bind a check run to its commit, which is what the merge
 * gate reads. An uploaded sequence has no such path. `GenomeUpload` screens it
 * in the browser, which is a check on what this tab *displays*, not a trust
 * boundary: wiring its output into a branch would put a client-screened,
 * pipeline-free sequence one click from a merge. Until an upload goes through
 * a server action that screens it again and runs the pipeline, it stays here,
 * for inspection only, and the tab says so.
 *
 * The uploaded model lives in this component's state, alongside
 * `GenomeUpload`'s own, so the two cannot disagree: leaving the tab discards
 * both, and the view returns to the demo genome together with the form.
 */

import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';

import { GenomeHelix3D, type GenomeModel } from '@/components/genome-3d';
import { GenomeUpload } from '@/components/genome-upload';
import type { LocusView } from '../model/types';

export interface UploadPanelProps {
  readonly locus: LocusView;
}

export function UploadPanel({ locus }: UploadPanelProps) {
  const [uploaded, setUploaded] = useState<GenomeModel | null>(null);

  return (
    <div className="work__pad">
      <div className="work__section-head">
        <div>
          <h2 className="work__h font-display">Upload a sequence</h2>
          <p className="work__sub">
            Compare your own {locus.gene} coding sequence with the curated reference
            allele. The upload is screened in your browser before this view reads it, then drawn below
            once it is accepted.
          </p>
        </div>
      </div>

      <div className="hairline rounded-lg border p-3">
        <GenomeUpload gene={locus.gene} onGenomeChange={setUploaded} />
      </div>

      <p className="limitation">
        <TriangleAlert className="limitation__icon" strokeWidth={1.75} aria-hidden="true" />
        <span>
          An uploaded sequence does not become a branch and cannot reach a merge. Branches
          are created from curated variants so that the gate screens each one and the
          pipeline runs before any downstream agent computes; an upload has no path through
          that gate yet, so it is shown here for inspection only. It is validated at the{' '}
          <span className="seq normal-case">Sequence</span> boundary — non-ACGT input is
          rejected with an error rather than silently truncated (SPEC §4.6 #13).
        </span>
      </p>

      {uploaded === null ? null : (
        <div className="hairline rounded-lg border p-3">
          <GenomeHelix3D model={uploaded} />
        </div>
      )}
    </div>
  );
}
