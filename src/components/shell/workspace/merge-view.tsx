'use client';

/**
 * The merge view — a pull request the gate can refuse.
 *
 * Every decision rendered here is `lib/merge-gate`'s `evaluateMerge()`,
 * computed on the server. This component makes no judgement of its own: it
 * does not decide that a merge is blocked, it reports which of the five
 * decision shapes came back.
 *
 * Sign-off (SPEC §7.5) is an explicit, named human action. The actor's name is
 * sent to the server and re-evaluated by `recordSignoff()` there, so a
 * signature can only clear a check that actually `requiresSignoff` — it can
 * never turn a failed check into a passing one, and nothing auto-approves.
 */

import { useEffect, useState, useTransition } from 'react';
import {
  CheckCircle2,
  GitMerge,
  Loader2,
  ShieldX,
  TriangleAlert,
  XCircle,
} from 'lucide-react';

import { mergeProposalAction } from '@/app/actions';
import type {
  BranchSpec,
  BranchView,
  CheckRunView,
  MergeProposalView,
} from '../model/types';
import { StatusMark, toneForCheck } from '../status';

export interface MergeViewProps {
  readonly branches: readonly BranchView[];
  readonly into: string;
  /** Replay list for branches the user created. */
  readonly overlay: readonly BranchSpec[];
  readonly defaultBranch: string;
}

export function MergeView({ branches, into, overlay, defaultBranch }: MergeViewProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const [signoff, setSignoff] = useState('');
  const [signatures, setSignatures] = useState<readonly string[]>([]);
  const [proposal, setProposal] = useState<MergeProposalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const others = branches.filter((b) => b.name !== into);

  // Derived rather than synchronised. The destination can change under this
  // component when the user switches branch, which would leave a stale
  // selection pointing at `into` — resolving it here keeps that impossible
  // without an effect that writes back into state.
  const incoming =
    picked !== null && picked !== into && others.some((b) => b.name === picked)
      ? picked
      : firstOther(branches, into);

  useEffect(() => {
    let live = true;
    startTransition(async () => {
      try {
        const next = await mergeProposalAction({
          into,
          incoming,
          signedOffBy: signatures,
          overlay,
        });
        if (live) {
          setProposal(next);
          setError(null);
        }
      } catch (cause) {
        if (live) {
          setError(cause instanceof Error ? cause.message : 'Could not evaluate the merge.');
        }
      }
    });
    return () => {
      live = false;
    };
  }, [into, incoming, signatures, overlay]);

  return (
    <div className="work__pad">
      <div className="work__section-head">
        <div>
          <h2 className="work__h font-display">Merge</h2>
          <p className="work__sub">
            A three-way merge of genotype trees, gated on the check run of every commit
            it would introduce. The gate is a required status check: a failing or
            unsigned check refuses the merge rather than warning beside it.
          </p>
        </div>
      </div>

      <div className="merge">
        <div className="merge__picker">
          <label htmlFor="merge-incoming">Merge</label>
          <select
            id="merge-incoming"
            className="merge__select"
            value={incoming}
            onChange={(event) => {
              setPicked(event.currentTarget.value);
              // A signature is for one specific proposal; changing the
              // incoming branch discards it rather than carrying it over.
              setSignatures([]);
              setSignoff('');
            }}
          >
            {others.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
          <span>into</span>
          <strong className="font-medium">{into}</strong>
          {into === defaultBranch ? (
            <span className="text-[0.75rem] text-muted-foreground">(default branch)</span>
          ) : null}
          {pending ? (
            <Loader2
              className="h-3.5 w-3.5 animate-spin text-muted-foreground"
              strokeWidth={2}
              aria-hidden="true"
            />
          ) : null}
        </div>

        {error === null ? null : (
          <p className="work__sub status--failed" role="alert">
            {error}
          </p>
        )}

        {proposal === null ? (
          <p className="work__sub" aria-live="polite">
            Evaluating the merge gate…
          </p>
        ) : (
          <>
            <Decision
              proposal={proposal}
              onSign={(actor) => setSignatures([actor])}
              signoff={signoff}
              setSignoff={setSignoff}
            />

            <dl className="facts">
              <div className="facts__row">
                <dt className="facts__k">Merge base</dt>
                <dd className="facts__v seq normal-case">
                  {proposal.mergeBaseShort ?? 'none — disjoint histories'}
                </dd>
              </div>
              <div className="facts__row">
                <dt className="facts__k">Commits introduced</dt>
                <dd className="facts__v">{proposal.introduced.length}</dd>
              </div>
              {proposal.signedOff.length === 0 ? null : (
                <div className="facts__row">
                  <dt className="facts__k">Signed off by</dt>
                  <dd className="facts__v">{proposal.signedOff.join(', ')}</dd>
                </div>
              )}
            </dl>

            {proposal.introduced.length === 0 ? null : (
              <section aria-labelledby="merge-commits-heading">
                <h3
                  className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground"
                  id="merge-commits-heading"
                >
                  Commits this merge would introduce
                </h3>
                <ul className="merge__commits" role="list">
                  {proposal.introduced.map((commit) => (
                    <li className="merge__commit" key={commit.oid}>
                      <span className="seq flex-none text-[0.75rem]">{commit.short}</span>
                      <span className="row__label">{commit.message}</span>
                      {commit.edit === null ? null : (
                        <span className="seq flex-none text-[0.75rem] text-muted-foreground">
                          {commit.edit.refCodon}→{commit.edit.altCodon} @{' '}
                          {commit.edit.codonIndex}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="limitation">
              <TriangleAlert
                className="limitation__icon"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span>
                Criss-cross histories can have several equally-good common ancestors.
                Git resolves that with a recursive merge; this prototype picks the
                lowest oid, which is deterministic and symmetric but not correct in the
                full sense (SPEC §4.6 #17).
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Decision({
  proposal,
  onSign,
  signoff,
  setSignoff,
}: {
  readonly proposal: MergeProposalView;
  readonly onSign: (actor: string) => void;
  readonly signoff: string;
  readonly setSignoff: (value: string) => void;
}) {
  const d = proposal.decision;

  switch (d.kind) {
    case 'allowed':
      return (
        <div className="merge__verdict status--passed">
          <p className="merge__verdict-head">
            <CheckCircle2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Merge allowed
          </p>
          <p className="m-0 text-[0.8125rem]">
            Every introduced commit has a completed, passing check. The merge commit is{' '}
            <span className="seq">{d.short}</span>, with{' '}
            <span className="seq normal-case">parents: [ours, theirs]</span> and author{' '}
            <span className="seq normal-case">sigmafold-merge</span>.
          </p>
        </div>
      );

    case 'check-failed':
      return (
        <div className="merge__verdict status--failed">
          <p className="merge__verdict-head">
            <XCircle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Merge refused — required check failed
          </p>
          <ul className="merge__reasons">
            {d.reasons.map((reason, i) => (
              <li key={`${i}-${reason.slice(0, 24)}`}>{reason}</li>
            ))}
          </ul>
          <BlockingChecks checks={d.blocking} />
          <p className="m-0 text-[0.75rem] text-muted-foreground">
            A failed check cannot be signed off. The edit has to change.
          </p>
        </div>
      );

    case 'awaiting-signoff':
      return (
        <div className="merge__verdict status--escalated">
          <p className="merge__verdict-head">
            <TriangleAlert className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Merge held — awaiting {d.signoffRole.replace(/_/g, ' ')}
          </p>
          <p className="m-0 text-[0.8125rem]">
            The biosafety gate escalated this edit. Escalations require an explicit,
            named human sign-off; nothing auto-approves one.
          </p>
          <BlockingChecks checks={d.blocking} />
          <form
            className="merge__signoff"
            onSubmit={(event) => {
              event.preventDefault();
              const actor = signoff.trim();
              if (actor.length > 0) onSign(actor);
            }}
          >
            <div className="flex flex-col gap-1">
              <label
                className="text-[0.6875rem] font-medium uppercase tracking-[0.04em] text-muted-foreground"
                htmlFor="signoff-actor"
              >
                Sign off as ({d.signoffRole.replace(/_/g, ' ')})
              </label>
              <input
                id="signoff-actor"
                className="merge__select min-w-[14rem]"
                value={signoff}
                onChange={(event) => setSignoff(event.currentTarget.value)}
                placeholder="Named reviewer"
                autoComplete="off"
              />
            </div>
            <button type="submit" className="rt__send" disabled={signoff.trim().length === 0}>
              <GitMerge className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Record sign-off
            </button>
          </form>
        </div>
      );

    case 'content-conflict':
      return (
        <div className="merge__verdict status--failed">
          <p className="merge__verdict-head">
            <ShieldX className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Merge conflict — not auto-resolved
          </p>
          <p className="m-0 text-[0.8125rem]">
            Both lines changed the same gene differently from the merge base. A
            genotype conflict is not something a tool should guess at, so nothing was
            written.
          </p>
          <ul className="merge__reasons">
            {d.conflicts.map((c) => (
              <li key={c.gene}>
                <span className="seq normal-case">{c.gene}</span>: base{' '}
                <span className="seq normal-case">
                  {c.base === null ? 'absent' : c.base.slice(0, 12)}
                </span>
                , ours{' '}
                <span className="seq normal-case">
                  {c.ours === null ? 'absent' : c.ours.slice(0, 12)}
                </span>
                , theirs{' '}
                <span className="seq normal-case">
                  {c.theirs === null ? 'absent' : c.theirs.slice(0, 12)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );

    case 'check-missing':
      return (
        <div className="merge__verdict status--pending">
          <p className="merge__verdict-head">
            <TriangleAlert className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Merge refused — no completed check
          </p>
          <p className="m-0 text-[0.8125rem]">
            {d.commits.length} introduced commit{d.commits.length === 1 ? '' : 's'} have
            no finished check run. An unchecked commit is refused rather than assumed
            good.
          </p>
          <ul className="merge__reasons">
            {d.commits.map((oid) => (
              <li key={oid} className="seq normal-case">
                {oid.slice(0, 12)}
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

function BlockingChecks({ checks }: { readonly checks: readonly CheckRunView[] }) {
  if (checks.length === 0) return null;
  return (
    <ul className="merge__commits" role="list">
      {checks.map((check) => (
        <li className="merge__commit" key={check.id}>
          <StatusMark tone={toneForCheck(check)} />
          <span className="seq flex-none text-[0.75rem]">{check.commit.slice(0, 12)}</span>
          <span className="row__label text-[0.75rem] text-muted-foreground">
            check {check.id.slice(0, 12)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function firstOther(branches: readonly BranchView[], into: string): string {
  const other = branches.find((b) => b.name !== into);
  if (other === undefined) {
    throw new Error('shell: a merge view needs at least two branches');
  }
  return other.name;
}
