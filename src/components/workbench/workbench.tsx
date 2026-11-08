'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, X } from 'lucide-react';

import type { AssertionData, AnyDelta, WorkspaceSnapshot } from '@/lib/workbench/types';

import { BranchRail } from './branch-rail';
import { CasePanel } from './case-panel';
import type { CardActions } from './delta-card';
import { Header } from './header';
import { useIdentity } from './identity';
import { branchTimeline, MAIN } from './model';
import { TimelinePane } from './timeline';
import { useWorkbench, type Notice } from './use-workbench';
import './workbench.css';

function flash(id: string): boolean {
  const el = document.getElementById(`delta-${id}`);
  if (!el) return false;
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  el.classList.remove('wb-flash');
  void el.offsetWidth;
  el.classList.add('wb-flash');
  el.focus({ preventScroll: true });
  return true;
}

export function Workbench() {
  const { identity, setIdentity } = useIdentity();
  const wb = useWorkbench(identity);
  return wb.snapshot ? (
    <WorkbenchView wb={wb} snapshot={wb.snapshot} identity={identity} setIdentity={setIdentity} />
  ) : (
    <div className="wb-root">
      <Header ai={null} identity={identity} onIdentity={setIdentity} onReset={wb.reset} resetting={false} canReset={false} />
      <div className="wb-loading">
        {wb.loadError ? (
          <div className="wb-loading__card" role="alert">
            <AlertTriangle className="size-5 text-verdict-escalate" aria-hidden="true" />
            <p className="wb-strong">Could not load the workbench.</p>
            <p className="wb-small wb-muted">{wb.loadError}</p>
            <button type="button" className="wb-btn wb-btn--primary" onClick={wb.reload}>
              <RefreshCw className="size-3.5" aria-hidden="true" /> Retry
            </button>
          </div>
        ) : (
          <p className="wb-muted wb-small" role="status">
            <Loader2 className="wb-inline-icon wb-spin" aria-hidden="true" /> Loading the workspace…
          </p>
        )}
      </div>
    </div>
  );
}

interface ViewProps {
  readonly wb: ReturnType<typeof useWorkbench>;
  readonly snapshot: WorkspaceSnapshot;
  readonly identity: ReturnType<typeof useIdentity>['identity'];
  readonly setIdentity: ReturnType<typeof useIdentity>['setIdentity'];
}

export function WorkbenchView({ wb, snapshot, identity, setIdentity }: ViewProps) {
  const { selected, select, run, busy, sendComment, createBranch, assert } = wb;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingJump = useRef<string | null>(null);

  const timeline = useMemo(() => branchTimeline(snapshot, selected), [snapshot, selected]);
  const branch = snapshot.branches.find((b) => b.name === selected) ?? null;

  const deltaBranch = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of snapshot.deltas) map.set(d.id, d.branch);
    return map;
  }, [snapshot.deltas]);

  const jump = useCallback(
    (id: string) => {
      if (flash(id)) return;
      const owner = deltaBranch.get(id);
      if (!owner) return;
      pendingJump.current = id;
      select(owner);
    },
    [deltaBranch, select],
  );

  useEffect(() => {
    if (pendingJump.current && flash(pendingJump.current)) pendingJump.current = null;
  }, [timeline]);

  const actions: CardActions = useMemo(
    () => ({
      comment: (text: string, onDelta: string | null, askAgent: boolean) => sendComment(selected, text, onDelta, askAgent),
      fork: (delta: AnyDelta, title: string) => createBranch(title, { branch: delta.branch, delta: delta.id }),
      assert: (assertion: AssertionData) => assert(selected, assertion),
    }),
    [selected, sendComment, createBranch, assert],
  );

  const mainHead = snapshot.branches.find((b) => b.name === MAIN)?.head ?? null;

  return (
    <div className="wb-root">
      <Header
        ai={snapshot.ai ?? null}
        identity={identity}
        onIdentity={setIdentity}
        onReset={wb.reset}
        resetting={busy === 'reset'}
        canReset={run === null}
      />
      {wb.notice && <NoticeBar notice={wb.notice} onDismiss={wb.dismissNotice} />}
      <div className="wb-grid">
        <BranchRail
          snapshot={snapshot}
          selected={selected}
          onSelect={select}
          canCreate={identity !== null && run === null}
          onCreate={(title) => createBranch(title, { branch: MAIN, delta: mainHead })}
        />
        <TimelinePane
          snapshot={snapshot}
          branch={branch}
          branchName={selected}
          timeline={timeline}
          run={run}
          identity={identity}
          onSaveIdentity={setIdentity}
          busy={busy !== null}
          actions={actions}
          onSend={(text) => wb.sendPrompt(selected, text)}
          onJump={jump}
          scrollRef={scrollRef}
        />
        <CasePanel
          snapshot={snapshot}
          branch={branch}
          branchName={selected}
          timeline={timeline}
          identity={identity}
          onSaveIdentity={setIdentity}
          busy={busy}
          running={run !== null}
          refusal={wb.refusal}
          onSignoff={(c, rationale) => wb.signoff(selected, c, rationale)}
          onMerge={() => wb.merge(selected)}
          onSelect={select}
        />
      </div>
    </div>
  );
}

function NoticeBar({ notice, onDismiss }: { readonly notice: Notice; readonly onDismiss: () => void }) {
  const Icon = notice.tone === 'error' ? AlertTriangle : notice.tone === 'success' ? CheckCircle2 : Info;
  return (
    <div className={`wb-notice wb-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="wb-notice__text">{notice.text}</span>
      <button type="button" className="wb-icon-btn" aria-label="Dismiss" onClick={onDismiss}>
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
