'use client';

/**
 * Create a genotype line.
 *
 * GOALS.md §3 requires a judge to be able to create and switch branches and
 * watch the diff change, so this has to produce a real branch: a `Repo`
 * ref, an `applyVariant` commit, and its own pipeline run. The work happens
 * in `createBranchAction`; this is the form.
 *
 * The edit is chosen from the locus's curated variants rather than typed,
 * because an arbitrary edit would have no structural annotation behind it and
 * the planner would have nothing to resolve — the picker's options come from
 * `data/loci.json`.
 */

import { useId, useState, useTransition } from 'react';
import { GitBranchPlus, Loader2 } from 'lucide-react';

import { createBranchAction } from '@/app/actions';
import type { BranchSpec, BranchView, EditView, WorkspaceView } from './model/types';

export interface NewBranchProps {
  readonly branches: readonly BranchView[];
  readonly variants: readonly EditView[];
  readonly from: string;
  readonly overlay: readonly BranchSpec[];
  readonly onCreated: (
    workspace: WorkspaceView,
    overlay: readonly BranchSpec[],
    created: string,
  ) => void;
}

export function NewBranch({
  branches,
  variants,
  from,
  overlay,
  onCreated,
}: NewBranchProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [variantId, setVariantId] = useState(() => variants[0]?.variantId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nameId = useId();
  const variantSelectId = useId();
  const sourceId = useId();
  const [source, setSource] = useState(from);

  // The source defaults to whatever branch is selected, but stays editable, so
  // it follows the rail without overriding a deliberate choice.
  const effectiveSource = branches.some((b) => b.name === source) ? source : from;

  if (!open) {
    return (
      <button
        type="button"
        className="row"
        onClick={() => {
          setSource(from);
          setOpen(true);
        }}
      >
        <GitBranchPlus className="row__icon" strokeWidth={1.75} aria-hidden="true" />
        <span className="row__label">New line…</span>
      </button>
    );
  }

  return (
    <form
      className="newbranch"
      onSubmit={(event) => {
        event.preventDefault();
        if (variantId === '') {
          setError('Pick an edit to apply.');
          return;
        }
        startTransition(async () => {
          try {
            const result = await createBranchAction({
              name,
              from: effectiveSource,
              variantId,
              overlay,
            });
            onCreated(result.workspace, result.overlay, name.trim());
            setName('');
            setError(null);
            setOpen(false);
          } catch (cause) {
            setError(
              cause instanceof Error ? cause.message : 'Could not create the branch.',
            );
          }
        });
      }}
    >
      <div className="newbranch__field">
        <label className="newbranch__label" htmlFor={nameId}>
          Name
        </label>
        <input
          id={nameId}
          className="newbranch__input"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="line/my-proposal"
          autoComplete="off"
          autoFocus
        />
      </div>

      <div className="newbranch__field">
        <label className="newbranch__label" htmlFor={sourceId}>
          From
        </label>
        <select
          id={sourceId}
          className="newbranch__input"
          value={effectiveSource}
          onChange={(event) => setSource(event.currentTarget.value)}
        >
          {branches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="newbranch__field">
        <label className="newbranch__label" htmlFor={variantSelectId}>
          Edit
        </label>
        <select
          id={variantSelectId}
          className="newbranch__input"
          value={variantId}
          onChange={(event) => setVariantId(event.currentTarget.value)}
        >
          {variants.map((v) =>
            v.variantId === null ? null : (
              <option key={v.variantId} value={v.variantId}>
                {v.label} — codon {v.codonIndex}
              </option>
            ),
          )}
        </select>
      </div>

      {error === null ? null : (
        <p className="newbranch__error" role="alert">
          {error}
        </p>
      )}

      <div className="newbranch__actions">
        <button type="submit" className="rt__send" disabled={pending}>
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
          ) : null}
          {pending ? 'Creating' : 'Create'}
        </button>
        <button
          type="button"
          className="chrome-btn"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
