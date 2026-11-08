'use client';

import { useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleMinus,
  GitMerge,
  Lock,
  ShieldX,
  Signature,
  XCircle,
} from 'lucide-react';

import type { AcmgClassification } from '@/lib/acmg/types';
import { ACMG_CLASSIFICATIONS } from '@/lib/acmg/types';
import type { HumanIdentity } from '@/lib/workbench/api-types';
import type { MergeCheck, MergeStatus, WbBranch, WbDelta, WorkspaceSnapshot } from '@/lib/workbench/types';

import { AlphaMissenseBar, ClassPill, IdentityForm } from './bits';
import { humanRole, ReferenceComparisonView } from './delta-card';
import { Term } from './glossary';
import { branchTimeline, classMeaning, formatOneIn, formatPercent, latestOfKind, MAIN, type Timeline } from './model';
import type { MergeRefusal } from './use-workbench';

export interface CasePanelProps {
  readonly snapshot: WorkspaceSnapshot;
  readonly branch: WbBranch | null;
  readonly branchName: string;
  readonly timeline: Timeline;
  readonly identity: HumanIdentity | null;
  readonly onSaveIdentity: (identity: HumanIdentity) => void;
  readonly busy: string | null;
  readonly running: boolean;
  readonly refusal: MergeRefusal | null;
  readonly onSignoff: (finalClassification: AcmgClassification, rationale: string) => Promise<boolean>;
  readonly onMerge: () => Promise<void>;
  readonly onSelect: (name: string) => void;
}

export function CasePanel(props: CasePanelProps) {
  return (
    <aside className="wb-case" aria-label="Case panel">
      <header className="wb-pane-head">
        <h2 className="wb-pane-head__title">{props.branchName === MAIN ? 'Case record' : 'Case'}</h2>
      </header>
      <div className="wb-case__scroll">{props.branchName === MAIN ? <CaseRecord {...props} /> : <BranchCase {...props} />}</div>
    </aside>
  );
}

function Section({ title, children, aside }: { readonly title: ReactNode; readonly children: ReactNode; readonly aside?: ReactNode }) {
  return (
    <section className="wb-section">
      <h3 className="wb-section__title">
        <span>{title}</span>
        {aside}
      </h3>
      {children}
    </section>
  );
}

function BranchCase({
  snapshot,
  branch,
  branchName,
  timeline,
  identity,
  onSaveIdentity,
  busy,
  running,
  refusal,
  onSignoff,
  onMerge,
}: CasePanelProps) {
  const evidence = latestOfKind(timeline.items, 'evidence');
  const interpretation = latestOfKind(timeline.items, 'interpretation');
  const reference = latestOfKind(timeline.items, 'reference');
  const gate = latestOfKind(timeline.items, 'gate');
  const signoff = latestOfKind(timeline.items, 'signoff');
  const merge: MergeStatus | undefined = snapshot.merge?.[branchName];
  const merged = branch?.status === 'merged';
  const blocked = branch?.status === 'blocked' || gate?.data?.verdict === 'block';

  return (
    <>
      {blocked && (
        <div className="wb-banner wb-banner--block">
          <ShieldX className="size-4 shrink-0" aria-hidden="true" />
          <span>
            The safety gate blocked this request. There is nothing to classify or sign, and this branch can never merge.
          </span>
        </div>
      )}

      <Section title="Variant">
        <VariantSummary delta={evidence} />
      </Section>

      <Section title={<>Classification <Term k="ACMG" iconOnly /></>}>
        {interpretation?.data?.interpretation ? (
          <div className="wb-classblock">
            <ClassPill value={interpretation.data.interpretation.classification} size="lg" />
            <p className="wb-classblock__meaning">{classMeaning(interpretation.data.interpretation.classification)}</p>
            <p className="wb-small wb-muted">
              {fmtPoints(interpretation.data.interpretation.points)} points from{' '}
              {(interpretation.data.interpretation.engine?.criteria ?? [])
                .filter((c) => c.met && !(interpretation.data.interpretation.dismissed ?? []).some((d) => d.code === c.code))
                .map((c, i, all) => (
                  <span key={c.code}>
                    <Term k={c.code}>
                      <span className="font-mono">{c.code}</span>
                    </Term>
                    {i < all.length - 1 ? ', ' : ''}
                  </span>
                ))}
              {(interpretation.data.interpretation.engine?.criteria ?? []).every((c) => !c.met) && 'no met criteria'}
            </p>
          </div>
        ) : (
          <p className="wb-muted wb-small">No classification yet. The ACMG engine runs once evidence is in.</p>
        )}
      </Section>

      <Section title="Reference check">
        {reference ? (
          <ReferenceComparisonView delta={reference} compact />
        ) : (
          <p className="wb-muted wb-small">
            <Term k="ClinVar" /> is held back until the agent has classified, then compared.
          </p>
        )}
      </Section>

      <Section
        title="Merge gate"
        aside={
          merge ? (
            <span className={`wb-gate-state wb-gate-state--${merged ? 'merged' : merge.allowed ? 'pass' : 'block'}`}>
              {merged ? 'merged' : merge.allowed ? 'ready' : 'not ready'}
            </span>
          ) : null
        }
      >
        {merge?.checks?.length ? (
          <ul className="wb-checks">
            {merge.checks.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </ul>
        ) : (
          <p className="wb-muted wb-small">Checks appear once the branch has work on it.</p>
        )}
        {merge?.requiredRole && (
          <p className="wb-small">
            Policy requires sign-off from <strong>{humanRole(merge.requiredRole)}</strong>.
          </p>
        )}
      </Section>

      {!merged && !blocked && (
        <Section title="Sign-off">
          {signoff && (
            <p className="wb-small wb-signed">
              <Signature className="size-3.5" aria-hidden="true" />
              Signed by <strong>{signoff.actor?.name}</strong>
              {signoff.actor?.kind === 'human' && signoff.actor.role ? ` (${signoff.actor.role})` : ''} as{' '}
              <ClassPill value={signoff.data?.finalClassification} size="sm" />
            </p>
          )}
          {!interpretation ? (
            <p className="wb-muted wb-small">Sign-off opens once there is a classification to review.</p>
          ) : !identity ? (
            <IdentityForm compact onSave={onSaveIdentity} prompt="Sign-off is attributed to a named human. Who are you?" />
          ) : (
            <SignoffForm
              key={interpretation.id}
              agent={interpretation.data?.interpretation?.classification ?? null}
              major={reference?.data?.comparison?.severity === 'major'}
              identity={identity}
              requiredRole={merge?.requiredRole ?? null}
              disabled={running || busy !== null}
              resign={signoff !== null}
              onSubmit={onSignoff}
            />
          )}
        </Section>
      )}

      {!merged && !blocked && (
        <div className="wb-merge">
          <button
            type="button"
            className="wb-btn wb-btn--merge"
            disabled={!merge?.allowed || !identity || running || busy !== null}
            onClick={() => void onMerge()}
          >
            <GitMerge className="size-4" aria-hidden="true" />
            {busy === 'merge' ? 'Merging…' : 'Merge into main'}
          </button>
          {!merge?.allowed && (
            <p className="wb-small wb-muted">
              <Lock className="wb-inline-icon" aria-hidden="true" /> Merge stays locked until every check above passes.
            </p>
          )}
          {refusal && refusal.branch === branchName && (
            <div className="wb-callout wb-callout--block" role="alert">
              <XCircle className="size-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="wb-strong">Merge refused</p>
                <ul className="wb-reasons">
                  {(refusal.reasons.length ? refusal.reasons : ['The server refused the merge.']).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {merged && (
        <div className="wb-banner wb-banner--pass">
          <GitMerge className="size-4 shrink-0" aria-hidden="true" />
          <span>Merged into main. This branch is now part of the signed-off case record.</span>
        </div>
      )}
    </>
  );
}

function fmtPoints(n: number | null | undefined): string {
  if (typeof n !== 'number') return '—';
  return n > 0 ? `+${n}` : String(n);
}

const CHECK_ICON = { pass: CheckCircle2, fail: XCircle, pending: CircleDashed, 'n/a': CircleMinus } as const;

function CheckRow({ check }: { readonly check: MergeCheck }) {
  const Icon = CHECK_ICON[check.state] ?? CircleDashed;
  return (
    <li className={`wb-check-row wb-check-row--${check.state.replace('/', '')}`}>
      <Icon className="size-4 shrink-0 wb-check-row__icon" aria-hidden="true" />
      <span className="wb-check-row__text">
        <span className="wb-check-row__label">
          {check.label}
          <span className="sr-only">: {check.state}</span>
        </span>
        {check.detail && <span className="wb-check-row__detail">{check.detail}</span>}
      </span>
    </li>
  );
}

function VariantSummary({ delta }: { readonly delta: WbDelta<'evidence'> | null }) {
  const ev = delta?.data?.evidence;
  if (!ev) return <p className="wb-muted wb-small">No evidence yet. The agent fetches it after the safety gate allows the request.</p>;
  const v = ev.variant;
  const af = ev.population?.maxAf;
  const am = ev.predictors?.alphaMissense;
  const p = ev.protein;
  return (
    <div className="wb-variant">
      <p className="wb-variant__head">
        <span className="wb-variant__gene font-mono">{v?.gene ?? '—'}</span>
        <span className="font-mono wb-muted">{v?.rsid ?? ''}</span>
      </p>
      <p className="font-mono wb-small wb-break">{v?.hgvsProtein ?? v?.hgvsCoding ?? v?.id}</p>
      {p?.refAa && p.altAa && (
        <p className="wb-small">
          <span className="seq">{p.refAa}</span>
          <span className="nums">{p.position ?? ''}</span>
          <span className="seq">{p.altAa}</span>
          {p.refCodon && p.altCodon && (
            <span className="wb-muted">
              {' '}
              (<span className="seq">{p.refCodon}</span> → <span className="seq">{p.altCodon}</span>)
            </span>
          )}
        </p>
      )}
      <dl className="wb-kv wb-kv--compact">
        <div>
          <dt>
            <Term k="gnomAD" />
          </dt>
          <dd>
            {typeof af === 'number' && af > 0 ? (
              <>
                {formatPercent(af)} <span className="wb-muted">· {formatOneIn(af)}</span>
              </>
            ) : (
              'Absent'
            )}
          </dd>
        </div>
        <div>
          <dt>
            <Term k="AlphaMissense" />
          </dt>
          <dd>{typeof am === 'number' ? am.toFixed(3) : '—'}</dd>
        </div>
      </dl>
      <AlphaMissenseBar score={am} />
    </div>
  );
}

function SignoffForm({
  agent,
  major,
  identity,
  requiredRole,
  disabled,
  resign,
  onSubmit,
}: {
  readonly agent: AcmgClassification | null;
  readonly major: boolean;
  readonly identity: HumanIdentity;
  readonly requiredRole: string | null;
  readonly disabled: boolean;
  readonly resign: boolean;
  readonly onSubmit: (c: AcmgClassification, rationale: string) => Promise<boolean>;
}) {
  const [choice, setChoice] = useState<AcmgClassification>(agent ?? 'Uncertain Significance');
  const [rationale, setRationale] = useState('');
  const [sending, setSending] = useState(false);
  const differs = agent !== null && choice !== agent;
  const needsRationale = differs || major;
  const ok = !needsRationale || rationale.trim().length > 0;
  const roleMismatch =
    requiredRole !== null && humanRole(requiredRole).toLowerCase() !== (identity.role ?? '').toLowerCase();

  return (
    <form
      className="wb-signoff-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok || sending) return;
        setSending(true);
        const done = await onSubmit(choice, rationale);
        setSending(false);
        if (done) setRationale('');
      }}
    >
      <label className="wb-field">
        <span className="wb-field__label">Final classification</span>
        <select className="wb-input" value={choice} onChange={(e) => setChoice(e.target.value as AcmgClassification)}>
          {ACMG_CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>
              {c}
              {c === agent ? ' (agent)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="wb-field">
        <span className="wb-field__label">
          Rationale {needsRationale ? <span className="wb-required">required</span> : <span className="wb-muted">optional</span>}
        </span>
        <textarea
          className="wb-input wb-textarea"
          rows={3}
          value={rationale}
          aria-required={needsRationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder={
            major
              ? 'The agent disagrees with ClinVar. Explain which side you accept and why.'
              : differs
                ? 'Explain why you are overriding the agent.'
                : 'Optional note for the record.'
          }
        />
      </label>
      {major && (
        <p className="wb-small wb-warn">
          <AlertTriangle className="wb-inline-icon" aria-hidden="true" /> Major disagreement with ClinVar: a rationale is required.
        </p>
      )}
      {roleMismatch && (
        <p className="wb-small wb-warn">
          <AlertTriangle className="wb-inline-icon" aria-hidden="true" /> Policy asks for {humanRole(requiredRole)}; you are signing as{' '}
          {identity.role ?? 'no role'}.
        </p>
      )}
      <div className="wb-row-actions">
        <span className="wb-small wb-muted">
          Signs as <strong>{identity.name}</strong>
          {identity.role ? `, ${identity.role}` : ''}
        </span>
        <span className="wb-card__spacer" />
        <button type="submit" className="wb-btn wb-btn--primary" disabled={!ok || disabled || sending}>
          <Signature className="size-3.5" aria-hidden="true" />
          {sending ? 'Signing…' : resign ? 'Sign again' : 'Sign off'}
        </button>
      </div>
    </form>
  );
}

function CaseRecord({ snapshot, onSelect }: CasePanelProps) {
  const merged = (snapshot.branches ?? []).filter((b) => b.status === 'merged');
  return (
    <>
      <p className="wb-small wb-muted">
        <code className="wb-code">main</code> holds only work that passed every check and was signed off by a named human.
      </p>
      {merged.length === 0 ? (
        <p className="wb-muted wb-small">Nothing has been merged yet.</p>
      ) : (
        <ul className="wb-record">
          {merged.map((b) => {
            const t = branchTimeline(snapshot, b.name);
            const signoff = latestOfKind(t.items, 'signoff');
            const evidence = latestOfKind(t.items, 'evidence');
            const v = evidence?.data?.evidence?.variant;
            return (
              <li key={b.name}>
                <button type="button" className="wb-record__item" onClick={() => onSelect(b.name)}>
                  <span className="wb-record__top">
                    <span className="wb-record__variant font-mono">
                      {[v?.gene, v?.hgvsProtein?.split(':').pop() ?? v?.rsid].filter(Boolean).join(' ') || b.title}
                    </span>
                    <ClassPill value={signoff?.data?.finalClassification ?? null} size="sm" />
                  </span>
                  <span className="wb-record__sub">
                    {b.title} · signed by {signoff?.actor?.name ?? 'unknown'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
