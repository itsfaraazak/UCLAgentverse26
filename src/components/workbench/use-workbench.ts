'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AcmgClassification } from '@/lib/acmg/types';
import type { HumanIdentity, StreamEvent } from '@/lib/workbench/api-types';
import type {
  AnyDelta,
  AssertionData,
  BranchStatus,
  WbBranch,
  WorkspaceSnapshot,
} from '@/lib/workbench/types';

import { api } from './api';
import { MAIN } from './model';

export interface RunState {
  /** Branch the live cards are landing on (follows an auto-created branch). */
  readonly branch: string;
  readonly label: string;
  readonly message: string;
  readonly startedAt: number;
}

export interface Notice {
  readonly tone: 'error' | 'info' | 'success';
  readonly text: string;
  readonly detail?: readonly string[];
}

export interface MergeRefusal {
  readonly branch: string;
  readonly reasons: readonly string[];
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Something went wrong.';
}

export function appendDelta(
  snapshot: WorkspaceSnapshot | null,
  delta: AnyDelta,
  origin: string,
): WorkspaceSnapshot | null {
  if (!snapshot || !delta || typeof delta.id !== 'string') return snapshot;
  if (snapshot.deltas.some((d) => d.id === delta.id)) return snapshot;
  const deltas = [...snapshot.deltas, delta].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const exists = snapshot.branches.some((b) => b.name === delta.branch);
  const branches: WbBranch[] = exists
    ? snapshot.branches.map((b) => (b.name === delta.branch ? { ...b, head: delta.id } : b))
    : [...snapshot.branches, stubBranch(snapshot, delta.branch, origin, delta)];
  return { ...snapshot, deltas, branches };
}

function stubBranch(
  snapshot: WorkspaceSnapshot,
  name: string,
  origin: string,
  delta: AnyDelta | null,
): WbBranch {
  const parent = snapshot.branches.find((b) => b.name === origin);
  return {
    name,
    title: delta?.kind === 'prompt' ? delta.title : 'New line of work',
    parent: { branch: origin, delta: parent?.head ?? null },
    createdBy: delta?.actor ?? { kind: 'agent', name: 'workbench', model: null },
    createdAt: delta?.at ?? new Date().toISOString(),
    status: 'running',
    head: delta?.id ?? null,
  };
}

function withStatus(snapshot: WorkspaceSnapshot | null, branch: string, status: BranchStatus) {
  if (!snapshot || !snapshot.branches.some((b) => b.name === branch)) return snapshot;
  return {
    ...snapshot,
    branches: snapshot.branches.map((b) => (b.name === branch ? { ...b, status } : b)),
  };
}

function newestNewBranch(snapshot: WorkspaceSnapshot, before: ReadonlySet<string>): string | null {
  const fresh = snapshot.branches.filter((b) => !before.has(b.name));
  if (fresh.length === 0) return null;
  return [...fresh].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0].name;
}

export function useWorkbench(identity: HumanIdentity | null) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRaw, setSelected] = useState<string>(MAIN);
  const [run, setRun] = useState<RunState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [refusal, setRefusal] = useState<MergeRefusal | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const snapshotRef = useRef<WorkspaceSnapshot | null>(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    let alive = true;
    api
      .snapshot()
      .then((s) => {
        if (!alive) return;
        setSnapshot(s);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (alive) setLoadError(message(error));
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('branch');
    if (fromUrl) setSelected(fromUrl);
  }, []);

  const selected =
    snapshot && snapshot.branches.some((b) => b.name === selectedRaw) ? selectedRaw : MAIN;

  useEffect(() => {
    if (!snapshot) return;
    const url = new URL(window.location.href);
    if (selected === MAIN) url.searchParams.delete('branch');
    else url.searchParams.set('branch', selected);
    window.history.replaceState(null, '', url);
  }, [selected, snapshot]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api.snapshot());
    } catch {
      // keep what we have; the notice already explains the failure
    }
  }, []);

  const stream = useCallback(
    async (
      origin: string,
      label: string,
      call: (onEvent: (event: StreamEvent) => void, signal: AbortSignal) => Promise<void>,
    ) => {
      const current = snapshotRef.current;
      if (!current) return;
      const before = new Set(current.branches.map((b) => b.name));
      const controller = new AbortController();
      abortRef.current = controller;
      setNotice(null);
      setRefusal(null);
      setRun({ branch: origin, label, message: 'Sending to the workbench…', startedAt: Date.now() });

      const seen: { followed: string | null; done: WorkspaceSnapshot | null } = { followed: null, done: null };
      const follow = (name: string | undefined) => {
        if (!name || before.has(name) || seen.followed === name) return;
        seen.followed = name;
        setSelected(name);
        setRun((r) => (r ? { ...r, branch: name } : r));
        setSnapshot((s) =>
          s && !s.branches.some((b) => b.name === name)
            ? { ...s, branches: [...s.branches, stubBranch(s, name, origin, null)] }
            : s,
        );
      };

      const onEvent = (event: StreamEvent) => {
        switch (event.type) {
          case 'delta':
            if (!event.delta) return;
            follow(event.delta.branch);
            setSnapshot((s) => appendDelta(s, event.delta, origin));
            return;
          case 'status':
            follow(event.branch);
            setSnapshot((s) => withStatus(s, event.branch, event.status));
            return;
          case 'progress':
            follow(event.branch);
            setRun((r) => (r ? { ...r, message: event.message || r.message } : r));
            return;
          case 'done':
            if (event.snapshot) {
              seen.done = event.snapshot;
              setSnapshot(event.snapshot);
            }
            return;
          case 'error':
            setNotice({ tone: 'error', text: event.message || 'The agent run failed.' });
            return;
          default:
            return;
        }
      };

      try {
        await call(onEvent, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) setNotice({ tone: 'error', text: message(error) });
      } finally {
        abortRef.current = null;
        setRun(null);
      }
      if (seen.done) {
        if (origin === MAIN || seen.followed) {
          const fresh = newestNewBranch(seen.done, before);
          if (fresh) setSelected(fresh);
        }
      } else if (!controller.signal.aborted) {
        await refresh();
      }
    },
    [refresh],
  );

  const needIdentity = useCallback((): HumanIdentity | null => {
    if (!identity) setNotice({ tone: 'info', text: 'Tell the workbench who you are before acting.' });
    return identity;
  }, [identity]);

  const act = useCallback(
    async (label: string, fn: () => Promise<WorkspaceSnapshot>): Promise<WorkspaceSnapshot | null> => {
      setBusy(label);
      setNotice(null);
      try {
        const next = await fn();
        setSnapshot(next);
        return next;
      } catch (error) {
        setNotice({ tone: 'error', text: message(error) });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const sendPrompt = useCallback(
    async (branch: string, text: string) => {
      const by = needIdentity();
      if (!by || !text.trim()) return;
      await stream(branch, 'Agent run', (onEvent, signal) =>
        api.prompt({ branch, text: text.trim(), by }, onEvent, signal),
      );
    },
    [needIdentity, stream],
  );

  const sendComment = useCallback(
    async (branch: string, text: string, onDelta: string | null, askAgent: boolean) => {
      const by = needIdentity();
      if (!by || !text.trim()) return false;
      const body = { branch, text: text.trim(), onDelta, askAgent, by };
      if (askAgent) {
        await stream(branch, 'Agent reply', (onEvent, signal) => api.comment(body, onEvent, signal));
        return true;
      }
      const saved = await act('comment', async () => {
        const box: { result: WorkspaceSnapshot | null; error: string | null } = { result: null, error: null };
        await api.comment(body, (event) => {
          if (event.type === 'done') box.result = event.snapshot;
          if (event.type === 'error') box.error = event.message;
        });
        if (box.error) throw new Error(box.error);
        if (!box.result) throw new Error('The comment was not saved.');
        return box.result;
      });
      return saved !== null;
    },
    [act, needIdentity, stream],
  );

  const createBranch = useCallback(
    async (title: string, from: { branch: string; delta: string | null } | null) => {
      const by = needIdentity();
      if (!by) return false;
      const before = new Set((snapshotRef.current?.branches ?? []).map((b) => b.name));
      const next = await act('branch', () => api.createBranch({ title: title.trim(), from, by }));
      if (!next) return false;
      const fresh = newestNewBranch(next, before);
      if (fresh) setSelected(fresh);
      return true;
    },
    [act, needIdentity],
  );

  const assert = useCallback(
    async (branch: string, assertion: AssertionData) => {
      const by = needIdentity();
      if (!by) return false;
      return (await act('assert', () => api.assert({ branch, assertion, by }))) !== null;
    },
    [act, needIdentity],
  );

  const signoff = useCallback(
    async (branch: string, finalClassification: AcmgClassification, rationale: string) => {
      const by = needIdentity();
      if (!by) return false;
      return (
        (await act('signoff', () => api.signoff({ branch, finalClassification, rationale: rationale.trim(), by }))) !==
        null
      );
    },
    [act, needIdentity],
  );

  const merge = useCallback(
    async (branch: string) => {
      const by = needIdentity();
      if (!by) return;
      setRefusal(null);
      await act('merge', async () => {
        const result = await api.merge({ branch, by });
        if (result.merged) {
          setNotice({ tone: 'success', text: `Merged ${branch} into ${MAIN}. The case record is updated.` });
        } else {
          setRefusal({ branch, reasons: result.reasons ?? [] });
        }
        return result.snapshot;
      });
    },
    [act, needIdentity],
  );

  const reset = useCallback(async () => {
    abortRef.current?.abort();
    const next = await act('reset', () => api.reset());
    if (next) {
      setSelected(MAIN);
      setRefusal(null);
    }
  }, [act]);

  return {
    snapshot,
    loadError,
    selected,
    select: setSelected,
    run,
    busy,
    notice,
    dismissNotice: () => setNotice(null),
    refusal,
    reload,
    sendPrompt,
    sendComment,
    createBranch,
    assert,
    signoff,
    merge,
    reset,
  };
}

export type WorkbenchState = ReturnType<typeof useWorkbench>;
