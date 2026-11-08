'use client';

import { Component, memo, useState, type ErrorInfo, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  BookMarked,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  FileWarning,
  FlaskConical,
  GitFork,
  GitMerge,
  ListChecks,
  Lock,
  MessageSquare,
  MessageSquareReply,
  PenLine,
  Scale,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Signature,
  Sparkles,
  Star,
  TerminalSquare,
  Users,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { AcmgCode } from '@/lib/acmg/types';
import type { AnyDelta, AssertionData, GateCategory, GateData, WbDelta } from '@/lib/workbench/types';
import type { CriterionDismissal } from '@/lib/evidence/types';

import { ActorAvatar, ActorName, AlphaMissenseBar, ClassPill, IdChip, SourceChip } from './bits';
import { Term } from './glossary';
import { Markdown } from './markdown';
import { classMeaning, formatOneIn, formatPercent, formatTime, shortId } from './model';

export interface CardActions {
  readonly comment: (text: string, onDelta: string | null, askAgent: boolean) => Promise<boolean>;
  readonly fork: (delta: AnyDelta, title: string) => Promise<boolean>;
  readonly assert: (assertion: AssertionData) => Promise<boolean>;
}

export interface CardContext {
  readonly knownIds: readonly string[];
  readonly timelineIds: ReadonlySet<string>;
  readonly redactedPrompts: ReadonlySet<string>;
  readonly onJump: (id: string) => void;
  /** Human actions are possible (identity set, nothing streaming). */
  readonly canAct: boolean;
  /** Assertions change the selected branch's classification; never on main. */
  readonly canAssert: boolean;
  readonly actions: CardActions;
}

const KIND_META: Readonly<Record<string, { label: string; icon: LucideIcon }>> = {
  prompt: { label: 'Prompt', icon: TerminalSquare },
  gate: { label: 'Safety gate', icon: ShieldCheck },
  plan: { label: 'Plan', icon: ListChecks },
  evidence: { label: 'Evidence', icon: FlaskConical },
  interpretation: { label: 'ACMG check', icon: Scale },
  reference: { label: 'Reference check', icon: BookMarked },
  literature: { label: 'Literature', icon: BookMarked },
  edit: { label: 'Edit proposal', icon: PenLine },
  message: { label: 'Agent message', icon: Sparkles },
  comment: { label: 'Comment', icon: MessageSquare },
  assertion: { label: 'Human evidence', icon: Users },
  signoff: { label: 'Sign-off', icon: Signature },
  merge: { label: 'Merge', icon: GitMerge },
  error: { label: 'Error', icon: FileWarning },
};

const CATEGORY_WORDS: Readonly<Record<GateCategory, string>> = {
  VARIANT_INTERPRETATION: 'Reading an observed variant (no edit proposed)',
  THERAPEUTIC_SOMATIC: 'Therapeutic edit to body cells (not inherited)',
  TUMOUR_SUPPRESSOR_DISRUPTION: 'Disrupting a gene that protects against cancer',
  GERMLINE_HERITABLE: 'Heritable edit (would pass to children)',
  MULTIPLEX_UNJUSTIFIED: 'Several edits at once with no medical reason given',
  CONSTRUCT_DESIGN_REQUEST: 'Asks for lab construct design',
  PATHOGEN_OR_TOXIN_ENHANCEMENT: 'Pathogen or toxin enhancement',
  OUT_OF_SCOPE: 'Outside what this tool models',
};

export function humanRole(role: string | null | undefined): string {
  if (!role) return '';
  const words = role.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

class CardBoundary extends Component<{ readonly fallback: ReactNode; readonly children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Workbench card failed to render', error, info.componentStack);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface DeltaCardProps {
  readonly delta: AnyDelta;
  readonly inherited: boolean;
  readonly ctx: CardContext;
}

export const DeltaCard = memo(function DeltaCard({ delta, inherited, ctx }: DeltaCardProps) {
  const [composing, setComposing] = useState<'comment' | 'fork' | null>(null);
  const meta = KIND_META[delta?.kind] ?? { label: delta?.kind || 'Delta', icon: CircleDashed };
  const KindIcon = meta.icon;
  const time = formatTime(delta?.at);
  const redacted = delta?.kind === 'prompt' && ctx.redactedPrompts.has(delta.id);
  const tone = cardTone(delta);

  return (
    <article
      id={`delta-${delta.id}`}
      className="wb-card"
      data-kind={delta.kind}
      data-tone={tone}
      data-inherited={inherited || undefined}
      aria-label={`${meta.label}: ${redacted ? 'withheld by policy' : delta.title}`}
      tabIndex={-1}
    >
      <div className="wb-card__gutter">
        <ActorAvatar actor={delta.actor} />
      </div>
      <div className="wb-card__main">
        <header className="wb-card__head">
          <ActorName actor={delta.actor} />
          <span className={`wb-kind wb-kind--${delta.kind}`}>
            <KindIcon className="size-3" aria-hidden="true" />
            {meta.label}
          </span>
          {inherited && <span className="wb-tag wb-tag--branch">{delta.branch}</span>}
          <span className="wb-card__spacer" />
          {time.short && (
            <time className="wb-card__time" dateTime={delta.at} title={time.full}>
              {time.short}
            </time>
          )}
          <IdChip id={delta.id} />
        </header>

        <h3 className="wb-card__title">
          {redacted ? (
            <span className="wb-redacted">
              <Lock className="size-3.5" aria-hidden="true" /> Prompt withheld by policy
            </span>
          ) : (
            delta.title || meta.label
          )}
        </h3>
        {!redacted && delta.body && delta.kind !== 'message' && <p className="wb-card__body">{delta.body}</p>}

        <CardBoundary fallback={<p className="wb-muted">This card’s details could not be displayed.</p>}>
          <KindBody delta={delta} ctx={ctx} redacted={redacted} />
        </CardBoundary>

        <footer className="wb-card__foot">
          {(delta.parents ?? []).length > 0 && (
            <span className="wb-chips" aria-label="Parents">
              <span className="wb-chips__label">parents</span>
              {(delta.parents ?? []).map((p) => (
                <ParentChip key={p} id={p} ctx={ctx} />
              ))}
            </span>
          )}
          {(delta.sources ?? []).length > 0 && (
            <span className="wb-chips" aria-label="Sources">
              {(delta.sources ?? []).map((s, i) => (
                <SourceChip key={`${s?.name}-${i}`} source={s} />
              ))}
            </span>
          )}
          <span className="wb-card__spacer" />
          {ctx.canAct && (
            <span className="wb-card__actions">
              <button
                type="button"
                className="wb-action"
                aria-expanded={composing === 'comment'}
                onClick={() => setComposing((c) => (c === 'comment' ? null : 'comment'))}
              >
                <MessageSquare className="size-3.5" aria-hidden="true" /> Comment
              </button>
              <button
                type="button"
                className="wb-action"
                aria-expanded={composing === 'fork'}
                onClick={() => setComposing((c) => (c === 'fork' ? null : 'fork'))}
              >
                <GitFork className="size-3.5" aria-hidden="true" /> Fork from here
              </button>
            </span>
          )}
        </footer>

        {composing === 'comment' && (
          <CommentBox
            onCancel={() => setComposing(null)}
            onSubmit={async (text, askAgent) => {
              const ok = await ctx.actions.comment(text, delta.id, askAgent);
              if (ok) setComposing(null);
            }}
          />
        )}
        {composing === 'fork' && (
          <ForkBox
            defaultTitle={`Alternative to: ${redacted ? 'withheld prompt' : delta.title}`.slice(0, 80)}
            onCancel={() => setComposing(null)}
            onSubmit={async (title) => {
              const ok = await ctx.actions.fork(delta, title);
              if (ok) setComposing(null);
            }}
          />
        )}
      </div>
    </article>
  );
});

function cardTone(delta: AnyDelta): string | undefined {
  switch (delta.kind) {
    case 'gate':
      return delta.data?.verdict;
    case 'error':
      return 'escalate';
    case 'reference':
      return delta.data?.comparison?.severity === 'major' ? 'block' : undefined;
    default:
      return undefined;
  }
}

function ParentChip({ id, ctx }: { readonly id: string; readonly ctx: CardContext }) {
  const here = ctx.timelineIds.has(id);
  const known = ctx.knownIds.includes(id);
  return (
    <button
      type="button"
      className="wb-chip"
      disabled={!known}
      onClick={() => ctx.onJump(id)}
      title={here ? `Scroll to ${id}` : known ? `On another branch: ${id}` : `Unknown delta ${id}`}
    >
      {shortId(id)}
    </button>
  );
}

function CommentBox({
  onSubmit,
  onCancel,
}: {
  readonly onSubmit: (text: string, askAgent: boolean) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [askAgent, setAskAgent] = useState(true);
  const [sending, setSending] = useState(false);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    await onSubmit(text, askAgent);
    setSending(false);
  };
  return (
    <form className="wb-inline-form" onSubmit={submit}>
      <label className="sr-only" htmlFor="wb-comment-text">
        Comment
      </label>
      <textarea
        id="wb-comment-text"
        className="wb-input wb-textarea"
        rows={2}
        autoFocus
        value={text}
        placeholder="Question this step, add context, or ask the agent to reconsider…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="wb-row-actions">
        <label className="wb-check">
          <input type="checkbox" checked={askAgent} onChange={(e) => setAskAgent(e.target.checked)} />
          <MessageSquareReply className="size-3.5" aria-hidden="true" /> Ask the agent to respond
        </label>
        <span className="wb-card__spacer" />
        <button type="button" className="wb-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="wb-btn wb-btn--primary" disabled={!text.trim() || sending}>
          {sending ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </form>
  );
}

function ForkBox({
  defaultTitle,
  onSubmit,
  onCancel,
}: {
  readonly defaultTitle: string;
  readonly onSubmit: (title: string) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [sending, setSending] = useState(false);
  return (
    <form
      className="wb-inline-form wb-inline-form--row"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim() || sending) return;
        setSending(true);
        await onSubmit(title);
        setSending(false);
      }}
    >
      <label className="wb-field wb-field--grow">
        <span className="wb-field__label">New branch title</span>
        <input className="wb-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <button type="button" className="wb-btn" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className="wb-btn wb-btn--primary" disabled={!title.trim() || sending}>
        <GitFork className="size-3.5" aria-hidden="true" /> {sending ? 'Forking…' : 'Fork'}
      </button>
    </form>
  );
}

function KindBody({ delta, ctx, redacted }: { readonly delta: AnyDelta; readonly ctx: CardContext; readonly redacted: boolean }) {
  switch (delta.kind) {
    case 'prompt':
      return redacted ? (
        <p className="wb-muted">
          The safety gate refused this request. Its text is not stored or shown; only a category and a digest are kept.
        </p>
      ) : delta.data?.text && delta.data.text !== delta.title ? (
        <blockquote className="wb-quote">{delta.data.text}</blockquote>
      ) : null;
    case 'gate':
      return <GateBody gate={delta.data} />;
    case 'plan':
      return <PlanBody steps={delta.data?.steps} />;
    case 'evidence':
      return <EvidenceBody delta={delta} />;
    case 'interpretation':
      return <InterpretationBody delta={delta} ctx={ctx} />;
    case 'reference':
      return <ReferenceBody delta={delta} />;
    case 'literature':
      return <LiteratureBody delta={delta} />;
    case 'edit':
      return <EditBody delta={delta} />;
    case 'message':
      return <Markdown text={delta.data?.markdown || delta.body} knownIds={ctx.knownIds} onDeltaRef={ctx.onJump} />;
    case 'comment':
      return (
        <div className="wb-comment">
          {delta.data?.onDelta && (
            <p className="wb-muted wb-small">
              on{' '}
              <button type="button" className="wb-chip" onClick={() => ctx.onJump(delta.data.onDelta!)}>
                {shortId(delta.data.onDelta)}
              </button>
            </p>
          )}
          <Markdown text={delta.data?.text} knownIds={ctx.knownIds} onDeltaRef={ctx.onJump} />
        </div>
      );
    case 'assertion':
      return <AssertionBody data={delta.data} />;
    case 'signoff':
      return <SignoffBody delta={delta} ctx={ctx} />;
    case 'merge':
      return (
        <p className="wb-small">
          <GitMerge className="wb-inline-icon" aria-hidden="true" /> Branch <code className="wb-code">{delta.data?.branch}</code> merged at{' '}
          <button type="button" className="wb-chip" onClick={() => delta.data?.branchHead && ctx.onJump(delta.data.branchHead)}>
            {shortId(delta.data?.branchHead)}
          </button>
        </p>
      );
    case 'error':
      return (
        <div className="wb-callout wb-callout--escalate" role="note">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <div>
            <p>{delta.data?.message || 'An error occurred.'}</p>
            <p className="wb-small wb-muted">
              {delta.data?.recoverable === false
                ? 'This step could not complete. Start a new prompt to try again.'
                : 'Recoverable: the run continued without this step. You can retry with a new prompt.'}
            </p>
          </div>
        </div>
      );
    default:
      return null;
  }
}

const VERDICT_ICON = { allow: ShieldCheck, escalate: ShieldAlert, block: ShieldX } as const;
const VERDICT_WORD = { allow: 'Allowed', escalate: 'Escalated to a human', block: 'Blocked' } as const;

export function GateVerdict({ gate }: { readonly gate: GateData | null | undefined }) {
  const verdict = gate?.verdict && gate.verdict in VERDICT_ICON ? gate.verdict : null;
  const Icon = verdict ? VERDICT_ICON[verdict] : CircleDashed;
  return (
    <span className={`wb-verdict wb-verdict--${verdict ?? 'neutral'}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      {verdict ? VERDICT_WORD[verdict] : 'No verdict'}
    </span>
  );
}

function GateBody({ gate }: { readonly gate: GateData | null | undefined }) {
  if (!gate) return null;
  return (
    <div className={`wb-gate wb-gate--${gate.verdict ?? 'neutral'}`}>
      <div className="wb-gate__row">
        <GateVerdict gate={gate} />
        <span className="wb-gate__category">{CATEGORY_WORDS[gate.category] ?? gate.category}</span>
      </div>
      {gate.reason && <p className="wb-gate__reason">{gate.reason}</p>}
      <dl className="wb-kv wb-kv--inline">
        {gate.mode && (
          <div>
            <dt>Mode</dt>
            <dd>{gate.mode === 'edit' ? 'Edit proposal' : 'Interpretation'}</dd>
          </div>
        )}
        {(gate.flaggedGenes ?? []).length > 0 && (
          <div>
            <dt>Flagged genes</dt>
            <dd className="font-mono">{gate.flaggedGenes.join(', ')}</dd>
          </div>
        )}
        {gate.requiresSignoff && (
          <div>
            <dt>Sign-off</dt>
            <dd>Required{gate.signoffRole ? ` from ${humanRole(gate.signoffRole)}` : ''}</dd>
          </div>
        )}
        {gate.requestDigest && (
          <div>
            <dt>Request digest</dt>
            <dd className="font-mono">{gate.requestDigest.slice(0, 12)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function PlanBody({ steps }: { readonly steps: readonly string[] | null | undefined }) {
  if (!steps?.length) return null;
  return (
    <ol className="wb-plan">
      {steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
  );
}

const CONSEQUENCE_WORDS: Readonly<Record<string, string>> = {
  missense: 'Missense: swaps one amino acid',
  synonymous: 'Synonymous: no amino-acid change',
  stop_gained: 'Stop gained: protein cut short',
  frameshift: 'Frameshift: scrambles the protein after this point',
  splice: 'Splice: disrupts how the gene is spliced',
  inframe_indel: 'In-frame insertion/deletion',
  start_lost: 'Start lost: protein not made',
  other: 'Other',
  unknown: 'Unknown',
};

function EvidenceBody({ delta }: { readonly delta: WbDelta<'evidence'> }) {
  const ev = delta.data?.evidence;
  if (!ev) return null;
  const v = ev.variant;
  const p = ev.protein;
  const af = ev.population?.maxAf;
  const am = ev.predictors?.alphaMissense;
  const cadd = ev.predictors?.caddPhred;
  return (
    <div className="wb-evidence">
      <dl className="wb-kv">
        <div>
          <dt>Gene</dt>
          <dd className="wb-strong font-mono">{v?.gene ?? '—'}</dd>
        </div>
        <div>
          <dt>
            <Term k="rsID" />
          </dt>
          <dd className="font-mono">{v?.rsid ?? '—'}</dd>
        </div>
        <div className="wb-kv__wide">
          <dt>
            <Term k="HGVS" />
          </dt>
          <dd className="font-mono wb-break">
            {[v?.hgvsCoding, v?.hgvsProtein].filter(Boolean).join('  ·  ') || v?.id || '—'}
          </dd>
        </div>
        <div className="wb-kv__wide">
          <dt>Consequence</dt>
          <dd>{CONSEQUENCE_WORDS[ev.consequence] ?? ev.consequence ?? '—'}</dd>
        </div>
      </dl>

      {p && (p.refAa || p.refCodon) && (
        <div className="wb-protein" aria-label="Protein change">
          <div className="wb-protein__side">
            <span className="wb-protein__label">Reference</span>
            <span className="seq wb-protein__aa">{p.refAa ?? '?'}</span>
            <span className="seq wb-protein__codon">{p.refCodon ?? '···'}</span>
          </div>
          <div className="wb-protein__arrow" aria-hidden="true">
            <span className="seq">{p.position ?? ''}</span>→
          </div>
          <div className="wb-protein__side wb-protein__side--alt">
            <span className="wb-protein__label">Patient</span>
            <span className="seq wb-protein__aa">{p.altAa ?? '?'}</span>
            <span className="seq wb-protein__codon">
              <CodonDiff from={p.refCodon} to={p.altCodon} />
            </span>
          </div>
        </div>
      )}

      <div className="wb-metrics">
        <div className="wb-metric">
          <span className="wb-metric__k">
            <Term k="gnomAD" /> frequency
          </span>
          {typeof af === 'number' && af > 0 ? (
            <>
              <span className="wb-metric__v">{formatPercent(af)}</span>
              <span className="wb-metric__note">{formatOneIn(af)} people carry it</span>
            </>
          ) : af === 0 || af === null ? (
            <>
              <span className="wb-metric__v">Absent</span>
              <span className="wb-metric__note">Not seen in gnomAD</span>
            </>
          ) : (
            <span className="wb-metric__v wb-muted">—</span>
          )}
        </div>
        <div className="wb-metric wb-metric--wide">
          <span className="wb-metric__k">
            <Term k="AlphaMissense" /> score
          </span>
          <span className="wb-metric__v">{typeof am === 'number' ? am.toFixed(3) : '—'}</span>
          <AlphaMissenseBar score={am} />
        </div>
        <div className="wb-metric">
          <span className="wb-metric__k">
            <Term k="CADD" /> phred
          </span>
          <span className="wb-metric__v">{typeof cadd === 'number' ? cadd.toFixed(1) : '—'}</span>
          {typeof cadd === 'number' && (
            <span className="wb-metric__note">{cadd >= 20 ? 'Top 1% most damaging' : 'Below the top-1% line'}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function CodonDiff({ from, to }: { readonly from: string | null; readonly to: string | null }) {
  if (!to) return <>···</>;
  return (
    <>
      {to.split('').map((base, i) => (
        <span key={i} className={from && from[i] !== base ? 'wb-base--changed' : undefined}>
          {base}
        </span>
      ))}
    </>
  );
}

function InterpretationBody({ delta, ctx }: { readonly delta: WbDelta<'interpretation'>; readonly ctx: CardContext }) {
  const interp = delta.data?.interpretation;
  const [dismissing, setDismissing] = useState<AcmgCode | null>(null);
  const [segregation, setSegregation] = useState(false);
  if (!interp) return null;
  const criteria = interp.engine?.criteria ?? [];
  const dismissed = new Map<string, CriterionDismissal>((interp.dismissed ?? []).map((d) => [d.code, d]));
  const allowActions = ctx.canAct && ctx.canAssert;
  const enginePoints = interp.engine?.points;
  return (
    <div className="wb-interp">
      <div className="wb-interp__head">
        <ClassPill value={interp.classification} size="lg" />
        <span className="wb-points">
          <span className="wb-points__v">{fmtPoints(interp.points)}</span> points
          {typeof enginePoints === 'number' && enginePoints !== interp.points && (
            <span className="wb-muted"> (engine {fmtPoints(enginePoints)} before dismissals)</span>
          )}
        </span>
      </div>
      <p className="wb-small wb-muted">{classMeaning(interp.classification)}</p>
      <div className="wb-table-wrap">
        <table className="wb-table">
          <caption className="sr-only">ACMG criteria</caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Met</th>
              <th scope="col" className="wb-num">
                Weight
              </th>
              <th scope="col">Why</th>
              {allowActions && <th scope="col" className="sr-only">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {criteria.map((c) => {
              const d = dismissed.get(c.code);
              return (
                <tr key={c.code} data-met={c.met || undefined} data-dismissed={d ? true : undefined}>
                  <td>
                    <Term k={c.code}>
                      <span className="font-mono wb-code-term">{c.code}</span>
                    </Term>
                  </td>
                  <td>
                    {c.met ? (
                      <CheckCircle2 className="size-4 wb-met" aria-label="met" />
                    ) : (
                      <span className="wb-muted" aria-label="not met">
                        —
                      </span>
                    )}
                  </td>
                  <td className="wb-num font-mono">{c.weight > 0 ? `+${c.weight}` : c.weight}</td>
                  <td>
                    <span className="wb-crit-note">{c.note}</span>
                    {d && (
                      <span className="wb-dismissal">
                        Dismissed by {d.by}: {d.reason}
                      </span>
                    )}
                    {dismissing === c.code && (
                      <ReasonForm
                        label={`Why should ${c.code} not apply?`}
                        submitLabel={`Dismiss ${c.code}`}
                        onCancel={() => setDismissing(null)}
                        onSubmit={async (reason) => {
                          const ok = await ctx.actions.assert({ kind: 'dismiss', code: c.code, reason });
                          if (ok) setDismissing(null);
                        }}
                      />
                    )}
                  </td>
                  {allowActions && (
                    <td className="wb-num">
                      {c.met && !d && dismissing !== c.code && (
                        <button type="button" className="wb-action" onClick={() => setDismissing(c.code)}>
                          <XCircle className="size-3.5" aria-hidden="true" /> Dismiss
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {allowActions && !segregation && (
        <button type="button" className="wb-action wb-action--outline" onClick={() => setSegregation(true)}>
          <Users className="size-3.5" aria-hidden="true" /> Add family segregation evidence
        </button>
      )}
      {segregation && (
        <SegregationForm
          onCancel={() => setSegregation(false)}
          onSubmit={async (value, reason) => {
            const ok = await ctx.actions.assert({ kind: 'segregation', value, reason });
            if (ok) setSegregation(false);
          }}
        />
      )}
      {interp.limitation && (
        <p className="wb-limitation">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          {interp.limitation}
        </p>
      )}
      {interp.citation && <p className="wb-small wb-muted">{interp.citation}</p>}
    </div>
  );
}

function fmtPoints(n: number | null | undefined): string {
  if (typeof n !== 'number') return '—';
  return n > 0 ? `+${n}` : String(n);
}

function ReasonForm({
  label,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  readonly label: string;
  readonly submitLabel: string;
  readonly onSubmit: (reason: string) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  return (
    <form
      className="wb-inline-form wb-inline-form--tight"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason.trim() || sending) return;
        setSending(true);
        await onSubmit(reason.trim());
        setSending(false);
      }}
    >
      <label className="wb-field">
        <span className="wb-field__label">{label}</span>
        <input className="wb-input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} required />
      </label>
      <div className="wb-row-actions">
        <button type="button" className="wb-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="wb-btn wb-btn--primary" disabled={!reason.trim() || sending}>
          {sending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function SegregationForm({
  onSubmit,
  onCancel,
}: {
  readonly onSubmit: (value: boolean, reason: string) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [value, setValue] = useState(true);
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  return (
    <form
      className="wb-inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason.trim() || sending) return;
        setSending(true);
        await onSubmit(value, reason.trim());
        setSending(false);
      }}
    >
      <fieldset className="wb-radios">
        <legend className="wb-field__label">Does the variant travel with the disease in the family?</legend>
        <label className="wb-check">
          <input type="radio" name="seg" checked={value} onChange={() => setValue(true)} /> Yes, it segregates with disease (
          <Term k="PP1" />)
        </label>
        <label className="wb-check">
          <input type="radio" name="seg" checked={!value} onChange={() => setValue(false)} /> No, it does not
        </label>
      </fieldset>
      <label className="wb-field">
        <span className="wb-field__label">Evidence (e.g. pedigree summary)</span>
        <input
          className="wb-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Mother and two affected aunts carry the variant; unaffected uncle does not"
          required
        />
      </label>
      <div className="wb-row-actions">
        <button type="button" className="wb-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="wb-btn wb-btn--primary" disabled={!reason.trim() || sending}>
          {sending ? 'Saving…' : 'Add evidence and re-classify'}
        </button>
      </div>
    </form>
  );
}

function Stars({ n }: { readonly n: number | null | undefined }) {
  const count = typeof n === 'number' ? Math.max(0, Math.min(4, n)) : 0;
  return (
    <span className="wb-stars" role="img" aria-label={`${count} of 4 review stars`}>
      {[0, 1, 2, 3].map((i) => (
        <Star key={i} className="size-3" data-on={i < count || undefined} aria-hidden="true" />
      ))}
    </span>
  );
}

const SEVERITY: Readonly<Record<string, { tone: string; text: string }>> = {
  none: { tone: 'pass', text: 'Agrees with ClinVar' },
  minor: { tone: 'escalate', text: 'Minor disagreement with ClinVar' },
  major: { tone: 'block', text: 'MAJOR disagreement with ClinVar: a human must review before merge' },
  unavailable: { tone: 'neutral', text: 'ClinVar has no usable consensus for this variant' },
};

export function ReferenceComparisonView({ delta, compact }: { readonly delta: WbDelta<'reference'>; readonly compact?: boolean }) {
  const cmp = delta.data?.comparison;
  if (!cmp) return null;
  const sev = SEVERITY[cmp.severity] ?? SEVERITY.unavailable;
  const cv = cmp.clinvar;
  return (
    <div className="wb-ref-cmp">
      <div className={`wb-banner wb-banner--${sev.tone}`} role={cmp.severity === 'major' ? 'alert' : undefined}>
        {cmp.severity === 'major' ? (
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        ) : cmp.severity === 'none' ? (
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <CircleDashed className="size-4 shrink-0" aria-hidden="true" />
        )}
        <span>{sev.text}</span>
      </div>
      <div className="wb-vs">
        <div className="wb-vs__side">
          <span className="wb-vs__label">Agent + ACMG engine</span>
          <ClassPill value={cmp.agentClassification} size={compact ? 'sm' : 'md'} />
        </div>
        <span className="wb-vs__mid" aria-hidden="true">
          vs
        </span>
        <div className="wb-vs__side">
          <span className="wb-vs__label">
            <Term k="ClinVar" />
          </span>
          {cv?.found ? <ClassPill value={cv.consensus} size={compact ? 'sm' : 'md'} /> : <span className="wb-muted">Not in ClinVar</span>}
          {cv?.found && (
            <span className="wb-vs__meta">
              <Stars n={cv.stars} />
              <Term k="Stars" iconOnly />
            </span>
          )}
        </div>
      </div>
      {!compact && cv?.reviewStatus && <p className="wb-small wb-muted">Review status: {cv.reviewStatus}</p>}
      {cmp.note && <p className="wb-small">{cmp.note}</p>}
      {cv?.url && (
        <a className="wb-link wb-small" href={cv.url} target="_blank" rel="noopener noreferrer">
          Open in ClinVar <ExternalLink className="wb-inline-icon" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

function ReferenceBody({ delta }: { readonly delta: WbDelta<'reference'> }) {
  return <ReferenceComparisonView delta={delta} />;
}

function LiteratureBody({ delta }: { readonly delta: WbDelta<'literature'> }) {
  const result = delta.data?.result;
  const papers = result?.papers ?? [];
  return (
    <div className="wb-lit">
      {result?.query && (
        <p className="wb-small wb-muted">
          Searched for <span className="font-mono">{result.query}</span>
        </p>
      )}
      {papers.length === 0 ? (
        <p className="wb-small wb-muted">No papers found.</p>
      ) : (
        <ul className="wb-papers">
          {papers.map((paper, i) => (
            <li key={paper.pmid ?? `${i}-${paper.title}`}>
              {paper.url ? (
                <a className="wb-link" href={paper.url} target="_blank" rel="noopener noreferrer">
                  {paper.title}
                </a>
              ) : (
                <span>{paper.title}</span>
              )}
              <span className="wb-paper__meta">
                {[paper.journal, paper.year, paper.pmid ? `PMID ${paper.pmid}` : null].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditBody({ delta }: { readonly delta: WbDelta<'edit'> }) {
  const edit = delta.data;
  if (!edit) return null;
  return (
    <div className="wb-edit">
      <dl className="wb-kv wb-kv--inline">
        <div>
          <dt>Gene</dt>
          <dd className="font-mono wb-strong">{edit.gene}</dd>
        </div>
        <div>
          <dt>Corrects</dt>
          <dd className="font-mono">{edit.variantId}</dd>
        </div>
      </dl>
      {edit.description && <p className="wb-small">{edit.description}</p>}
      <div className="wb-protein" aria-label="Proposed correction">
        <div className="wb-protein__side">
          <span className="wb-protein__label">Now</span>
          <span className="seq wb-protein__aa">{edit.aminoAcid?.from ?? '?'}</span>
          <span className="seq wb-protein__codon">{edit.codon?.from ?? '···'}</span>
        </div>
        <div className="wb-protein__arrow" aria-hidden="true">
          <span className="seq">{edit.codon?.position ?? ''}</span>→
        </div>
        <div className="wb-protein__side wb-protein__side--fix">
          <span className="wb-protein__label">Proposed</span>
          <span className="seq wb-protein__aa">{edit.aminoAcid?.to ?? '?'}</span>
          <span className="seq wb-protein__codon">
            <CodonDiff from={edit.codon?.from ?? null} to={edit.codon?.to ?? null} />
          </span>
        </div>
      </div>
      {edit.gate && (
        <div className="wb-gate__row">
          <span className="wb-small wb-muted">Edit gate:</span>
          <GateVerdict gate={edit.gate} />
          <span className="wb-small">{edit.gate.reason}</span>
        </div>
      )}
    </div>
  );
}

function AssertionBody({ data }: { readonly data: AssertionData | null | undefined }) {
  if (!data) return null;
  if (data.kind === 'dismiss') {
    return (
      <p className="wb-small">
        Dismissed{' '}
        <Term k={data.code}>
          <span className="font-mono wb-code-term">{data.code}</span>
        </Term>
        : {data.reason}
      </p>
    );
  }
  return (
    <p className="wb-small">
      Family segregation: <strong>{data.value ? 'segregates with disease' : 'does not segregate'}</strong>
      {data.reason ? ` — ${data.reason}` : ''}
    </p>
  );
}

function SignoffBody({ delta, ctx }: { readonly delta: WbDelta<'signoff'>; readonly ctx: CardContext }) {
  const s = delta.data;
  if (!s) return null;
  return (
    <div className="wb-signoff">
      <div className="wb-gate__row">
        <ClassPill value={s.finalClassification} />
        {s.agreesWithAgent ? (
          <span className="wb-small wb-muted">Agrees with the agent’s classification</span>
        ) : (
          <span className="wb-small">
            Overrides the agent ({s.agentClassification ?? 'none'} → {s.finalClassification})
          </span>
        )}
      </div>
      {s.rationale && <blockquote className="wb-quote">{s.rationale}</blockquote>}
      {s.covers && (
        <p className="wb-small wb-muted">
          Covers{' '}
          <button type="button" className="wb-chip" onClick={() => ctx.onJump(s.covers!)}>
            {shortId(s.covers)}
          </button>
        </p>
      )}
    </div>
  );
}
