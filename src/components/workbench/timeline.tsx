'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ArrowDown, CornerDownLeft, GitBranch, GitFork, Loader2, ShieldAlert, Sparkles } from 'lucide-react';

import type { HumanIdentity } from '@/lib/workbench/api-types';
import type { WbBranch, WorkspaceSnapshot } from '@/lib/workbench/types';

import { Elapsed, IdentityForm } from './bits';
import { DeltaCard, type CardActions, type CardContext } from './delta-card';
import { MAIN, shortId, type Timeline } from './model';
import type { RunState } from './use-workbench';

export const DEMO_PROMPTS: readonly { readonly text: string; readonly tag?: string }[] = [
  { text: 'Interpret BRCA1 c.5266dupC for a patient with a family history of breast cancer' },
  { text: 'Assess rs334 in a patient with recurrent pain crises' },
  { text: 'Propose correcting the sickle variant in HBB back to the reference sequence' },
  { text: 'Propose disrupting BRCA1', tag: 'red-team' },
  { text: 'Is CFTR p.Phe508del pathogenic?' },
];

export interface TimelinePaneProps {
  readonly snapshot: WorkspaceSnapshot;
  readonly branch: WbBranch | null;
  readonly branchName: string;
  readonly timeline: Timeline;
  readonly run: RunState | null;
  readonly identity: HumanIdentity | null;
  readonly onSaveIdentity: (identity: HumanIdentity) => void;
  readonly busy: boolean;
  readonly actions: CardActions;
  readonly onSend: (text: string) => Promise<void>;
  readonly onJump: (id: string) => void;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
}

const STICK_PX = 96;

export function TimelinePane({
  snapshot,
  branch,
  branchName,
  timeline,
  run,
  identity,
  onSaveIdentity,
  busy,
  actions,
  onSend,
  onJump,
  scrollRef,
}: TimelinePaneProps) {
  const stick = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [draft, setDraft] = useState('');
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const running = run !== null;
  const liveHere = run !== null && run.branch === branchName;
  const knownIds = useMemo(() => snapshot.deltas.map((d) => d.id), [snapshot.deltas]);
  const timelineIds = useMemo(() => new Set(timeline.items.map((i) => i.delta.id)), [timeline.items]);
  const redactedPrompts = useMemo(() => {
    const ids = new Set<string>();
    for (const d of snapshot.deltas) {
      if (d.kind === 'gate' && d.data?.redacted) for (const p of d.parents ?? []) ids.add(p);
    }
    return ids;
  }, [snapshot.deltas]);

  const ctx: CardContext = useMemo(
    () => ({
      knownIds,
      timelineIds,
      redactedPrompts,
      onJump,
      canAct: identity !== null && !running && !busy,
      canAssert: branchName !== MAIN && branch?.status !== 'merged',
      actions,
    }),
    [knownIds, timelineIds, redactedPrompts, onJump, identity, running, busy, branchName, branch?.status, actions],
  );

  useEffect(() => {
    stick.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [branchName, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [timeline.items.length, run?.message, liveHere, scrollRef]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    stick.current = near;
    if (near === awayFromBottom) setAwayFromBottom(!near);
  };

  const empty = timeline.items.length === 0 && !liveHere;
  const workspaceEmpty = snapshot.deltas.length === 0 && snapshot.branches.length <= 1;
  const forkIndex = timeline.ownStart;

  const pick = (text: string) => {
    setDraft(text);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  return (
    <section className="wb-center" aria-label="Timeline">
      <header className="wb-pane-head">
        <GitBranch className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <h2 className="wb-pane-head__title">
          <span className="font-mono">{branchName}</span>
          {branch?.title && branch.title !== branchName && <span className="wb-pane-head__sub">{branch.title}</span>}
        </h2>
        <span className="wb-card__spacer" />
        <span className="wb-small wb-muted nums">
          {timeline.items.length - forkIndex} own · {forkIndex} inherited
        </span>
      </header>

      <div className="wb-scroll" ref={scrollRef} onScroll={onScroll}>
        {empty ? (
          workspaceEmpty || branchName === MAIN ? (
            <Hero onPick={pick} mainEmpty={branchName === MAIN} />
          ) : (
            <div className="wb-empty">
              <p className="wb-empty__title">This branch has no deltas yet.</p>
              <p className="wb-muted wb-small">Send a prompt below, or start from one of these:</p>
              <DemoChips onPick={pick} />
            </div>
          )
        ) : (
          <ol className="wb-timeline" aria-live="off">
            {timeline.items.map((item, i) => (
              <li key={item.delta.id} className="wb-timeline__item">
                {i === forkIndex && forkIndex > 0 && timeline.fork && (
                  <div className="wb-fork-divider" role="separator">
                    <GitFork className="size-3.5" aria-hidden="true" />
                    <span>
                      <span className="font-mono">{branchName}</span> forked from{' '}
                      <span className="font-mono">{timeline.fork.branch}</span>
                      {timeline.fork.delta && (
                        <>
                          {' '}
                          at{' '}
                          <button type="button" className="wb-chip" onClick={() => onJump(timeline.fork!.delta!)}>
                            {shortId(timeline.fork.delta)}
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                )}
                <DeltaCard delta={item.delta} inherited={item.inherited} ctx={ctx} />
              </li>
            ))}
            {forkIndex === timeline.items.length && forkIndex > 0 && timeline.fork && (
              <li className="wb-timeline__item">
                <div className="wb-fork-divider" role="separator">
                  <GitFork className="size-3.5" aria-hidden="true" />
                  <span>
                    <span className="font-mono">{branchName}</span> forked here. Nothing on this branch yet.
                  </span>
                </div>
              </li>
            )}
            {liveHere && run && (
              <li className="wb-timeline__item">
                <StreamingCard run={run} />
              </li>
            )}
          </ol>
        )}
        {empty && liveHere && run && (
          <ol className="wb-timeline">
            <li className="wb-timeline__item">
              <StreamingCard run={run} />
            </li>
          </ol>
        )}
      </div>

      {awayFromBottom && !empty && (
        <button
          type="button"
          className="wb-jump"
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          }}
        >
          <ArrowDown className="size-3.5" aria-hidden="true" /> Latest
        </button>
      )}

      <div className="wb-composer-wrap">
        {!empty && timeline.items.length - forkIndex === 0 && !running && <DemoChips onPick={pick} compact />}
        {identity ? (
          <Composer
            ref={composerRef}
            draft={draft}
            setDraft={setDraft}
            branchName={branchName}
            running={running}
            disabled={busy}
            onSend={async (text) => {
              stick.current = true;
              setDraft('');
              await onSend(text);
            }}
          />
        ) : (
          <IdentityForm
            compact
            onSave={onSaveIdentity}
            prompt="Every delta is attributed. Who is reviewing? Your name and role sign everything you do here."
          />
        )}
      </div>
    </section>
  );
}

function Hero({ onPick, mainEmpty }: { readonly onPick: (text: string) => void; readonly mainEmpty: boolean }) {
  return (
    <div className="wb-hero">
      <p className="wb-hero__eyebrow">SigmaFold Workbench</p>
      <h2 className="wb-hero__title">Version control where clinical scientists and AI agents review genetic variants together.</h2>
      <ol className="wb-hero__lines">
        <li>
          <span className="wb-hero__n">1</span>
          Ask about a variant. A safety gate screens the request, then a Gemini agent pulls real evidence:
          population frequency, DeepMind’s AlphaMissense score and the literature.
        </li>
        <li>
          <span className="wb-hero__n">2</span>A deterministic ACMG rule engine classifies it, and the result is checked against ClinVar. Humans
          comment, add evidence or dismiss criteria, and the agent replies.
        </li>
        <li>
          <span className="wb-hero__n">3</span>
          Every step is an attributed, content-addressed delta on a branch. Nothing merges into <code className="wb-code">main</code>{' '}
          until every check passes and a named human signs off.
        </li>
      </ol>
      <p className="wb-small wb-muted">
        {mainEmpty ? 'Try one of these, or type your own. Sending from main opens a new branch.' : 'Try one of these:'}
      </p>
      <DemoChips onPick={onPick} />
    </div>
  );
}

function DemoChips({ onPick, compact }: { readonly onPick: (text: string) => void; readonly compact?: boolean }) {
  return (
    <div className={compact ? 'wb-demo wb-demo--compact' : 'wb-demo'} role="group" aria-label="Example prompts">
      {DEMO_PROMPTS.map((p) => (
        <button key={p.text} type="button" className="wb-demo__chip" data-tag={p.tag} onClick={() => onPick(p.text)}>
          {p.tag === 'red-team' && <ShieldAlert className="size-3.5" aria-hidden="true" />}
          <span>{p.text}</span>
          {p.tag && <span className="wb-demo__tag">{p.tag}</span>}
        </button>
      ))}
    </div>
  );
}

export function StreamingCard({ run }: { readonly run: RunState }) {
  return (
    <article className="wb-card wb-card--streaming" aria-busy="true" aria-label="Agent working">
      <div className="wb-card__gutter">
        <span className="wb-avatar wb-avatar--llm wb-avatar--md wb-avatar--pulse" aria-hidden="true">
          <Sparkles className="size-3.5" />
        </span>
      </div>
      <div className="wb-card__main">
        <header className="wb-card__head">
          <span className="wb-actor__name">{run.label}</span>
          <span className="wb-tag wb-tag--llm">working</span>
          <span className="wb-card__spacer" />
          <Elapsed since={run.startedAt} />
        </header>
        <p className="wb-stream__msg" role="status" aria-live="polite">
          <Loader2 className="size-3.5 wb-spin" aria-hidden="true" />
          <span>{run.message}</span>
        </p>
        <div className="wb-shimmer" aria-hidden="true">
          <span />
          <span />
        </div>
        <p className="wb-small wb-muted">Model turns take 15–45 seconds. Cards appear here as each step lands.</p>
      </div>
    </article>
  );
}

interface ComposerProps {
  readonly ref: RefObject<HTMLTextAreaElement | null>;
  readonly draft: string;
  readonly setDraft: (text: string) => void;
  readonly branchName: string;
  readonly running: boolean;
  readonly disabled: boolean;
  readonly onSend: (text: string) => Promise<void>;
}

function Composer({ ref, draft, setDraft, branchName, running, disabled, onSend }: ComposerProps) {
  const canSend = draft.trim().length > 0 && !running && !disabled;
  const send = () => {
    if (canSend) void onSend(draft);
  };
  return (
    <form
      className="wb-composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label className="sr-only" htmlFor="wb-composer">
        Prompt on {branchName}
      </label>
      <textarea
        id="wb-composer"
        ref={ref}
        className="wb-composer__input"
        rows={2}
        value={draft}
        placeholder={
          branchName === MAIN
            ? 'Ask about a variant (rsID, gene + HGVS, or plain words). A new branch opens automatically.'
            : `Prompt the agent on ${branchName}…`
        }
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="wb-composer__bar">
        <span className="wb-small wb-muted">
          {running ? (
            'The agent is working. You can read and comment once it finishes.'
          ) : (
            <>
              Sends to <span className="font-mono">{branchName === MAIN ? 'a new branch' : branchName}</span>
            </>
          )}
        </span>
        <span className="wb-card__spacer" />
        <kbd className="wb-kbd">Ctrl ↵</kbd>
        <button type="submit" className="wb-btn wb-btn--primary" disabled={!canSend}>
          {running ? <Loader2 className="size-3.5 wb-spin" aria-hidden="true" /> : <CornerDownLeft className="size-3.5" aria-hidden="true" />}
          Send
        </button>
      </div>
    </form>
  );
}
