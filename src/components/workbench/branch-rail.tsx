'use client';

import { useState } from 'react';
import { GitBranchPlus, Plus } from 'lucide-react';

import type { WbBranch, WorkspaceSnapshot } from '@/lib/workbench/types';

import { branchRows, deltaCount, MAIN, type GraphRow } from './model';

const ROW = 52;
const LANE = 14;
const PAD = 11;

const laneX = (lane: number) => PAD + lane * LANE;
const rowY = (row: number) => row * ROW + ROW / 2;
const laneColor = (lane: number) => `var(--graph-lane-${(lane % 6) + 1})`;

function CommitGraph({ rows }: { readonly rows: readonly GraphRow[] }) {
  const maxLane = rows.reduce((m, r) => Math.max(m, r.lane), 0);
  const width = laneX(maxLane) + PAD;
  const height = rows.length * ROW;
  return (
    <svg className="wb-graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {rows.length > 1 && (
        <line x1={laneX(0)} y1={rowY(0)} x2={laneX(0)} y2={height - 4} stroke={laneColor(0)} strokeWidth={2} strokeLinecap="round" />
      )}
      {rows.map((r) => {
        if (r.parentRow < 0) return null;
        const parent = rows[r.parentRow];
        const px = laneX(parent.lane);
        const py = rowY(parent.row);
        const cx = laneX(r.lane);
        const cy = rowY(r.row);
        const fork = `M ${px} ${py} V ${cy - 20} C ${px} ${cy - 6}, ${cx} ${cy - 14}, ${cx} ${cy}`;
        return (
          <g key={r.branch.name}>
            <path d={fork} fill="none" stroke={laneColor(r.lane)} strokeWidth={2} strokeLinecap="round" />
            {r.branch.status === 'merged' && (
              <path
                d={`M ${cx} ${cy} C ${cx} ${cy + 12}, ${laneX(0)} ${cy + 8}, ${laneX(0)} ${cy + ROW / 2}`}
                fill="none"
                stroke={laneColor(r.lane)}
                strokeWidth={2}
                strokeDasharray="3 3"
                strokeLinecap="round"
              />
            )}
          </g>
        );
      })}
      {rows.map((r) => {
        const cx = laneX(r.lane);
        const cy = rowY(r.row);
        const color = laneColor(r.lane);
        const status = r.branch.status;
        if (r.branch.name === MAIN) {
          return (
            <g key={`dot-${r.branch.name}`}>
              <circle cx={cx} cy={cy} r={6.5} fill="var(--background)" stroke={color} strokeWidth={2} />
              <circle cx={cx} cy={cy} r={3} fill={color} />
            </g>
          );
        }
        return (
          <circle
            key={`dot-${r.branch.name}`}
            className={status === 'running' ? 'wb-graph__pulse' : undefined}
            cx={cx}
            cy={cy}
            r={status === 'merged' ? 4.5 : 5}
            fill={status === 'merged' ? 'var(--background)' : status === 'blocked' ? 'var(--verdict-block)' : color}
            stroke={status === 'blocked' ? 'var(--verdict-block)' : color}
            strokeWidth={2}
          />
        );
      })}
    </svg>
  );
}

const STATUS_WORD: Readonly<Record<string, string>> = {
  open: 'open',
  running: 'running',
  blocked: 'blocked',
  merged: 'merged',
};

function readiness(snapshot: WorkspaceSnapshot, branch: WbBranch): { tone: string; label: string } {
  if (branch.name === MAIN) return { tone: 'neutral', label: 'Signed-off case record' };
  if (branch.status === 'merged') return { tone: 'merged', label: 'Merged into main' };
  const status = snapshot.merge?.[branch.name];
  if (!status) return { tone: 'neutral', label: 'Merge checks not computed yet' };
  if (status.allowed) return { tone: 'pass', label: 'Ready to merge' };
  const checks = status.checks ?? [];
  if (checks.some((c) => c.state === 'fail')) return { tone: 'block', label: 'Merge blocked: a check is failing' };
  return { tone: 'escalate', label: 'Merge checks pending' };
}

export interface BranchRailProps {
  readonly snapshot: WorkspaceSnapshot;
  readonly selected: string;
  readonly onSelect: (name: string) => void;
  readonly canCreate: boolean;
  readonly onCreate: (title: string) => Promise<boolean>;
}

export function BranchRail({ snapshot, selected, onSelect, canCreate, onCreate }: BranchRailProps) {
  const rows = branchRows(snapshot.branches ?? []);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [sending, setSending] = useState(false);
  const graphWidth = laneX(rows.reduce((m, r) => Math.max(m, r.lane), 0)) + PAD;

  return (
    <nav className="wb-rail" aria-label="Branches">
      <div className="wb-rail__head">
        <span className="wb-rail__heading">Branches</span>
        <span className="wb-small wb-muted nums">{Math.max(0, rows.length - 1)}</span>
        <span className="wb-card__spacer" />
        <button
          type="button"
          className="wb-icon-btn"
          aria-label="New branch"
          title={canCreate ? 'New branch from main' : 'Set your identity first'}
          aria-expanded={creating}
          disabled={!canCreate}
          onClick={() => setCreating((c) => !c)}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>

      {creating && (
        <form
          className="wb-newbranch"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim() || sending) return;
            setSending(true);
            const ok = await onCreate(title);
            setSending(false);
            if (ok) {
              setTitle('');
              setCreating(false);
            }
          }}
        >
          <label className="wb-field">
            <span className="wb-field__label">Branch title</span>
            <input
              className="wb-input"
              autoFocus
              value={title}
              placeholder="e.g. Re-review with family history"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
            />
          </label>
          <p className="wb-small wb-muted">Forks from the head of main.</p>
          <div className="wb-row-actions">
            <button type="button" className="wb-btn" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" className="wb-btn wb-btn--primary" disabled={!title.trim() || sending}>
              <GitBranchPlus className="size-3.5" aria-hidden="true" /> {sending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      <div className="wb-rail__list" style={{ ['--graph-w' as string]: `${graphWidth}px` }}>
        <CommitGraph rows={rows} />
        <ul className="wb-branches">
          {rows.map((r) => {
            const b = r.branch;
            const ready = readiness(snapshot, b);
            const count = deltaCount(snapshot, b.name);
            const isMain = b.name === MAIN;
            return (
              <li key={b.name}>
                <button
                  type="button"
                  className="wb-branch"
                  style={{ height: ROW }}
                  aria-current={selected === b.name ? 'true' : undefined}
                  onClick={() => onSelect(b.name)}
                >
                  <span className="wb-branch__text">
                    <span className="wb-branch__title">{isMain ? 'main' : b.title || b.name}</span>
                    <span className="wb-branch__sub">
                      {isMain ? (
                        <span>case record · {count} {count === 1 ? 'delta' : 'deltas'}</span>
                      ) : (
                        <>
                          <span className="font-mono wb-branch__name">{b.name}</span>
                          <span aria-hidden="true">·</span>
                          <span className="nums">{count}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="wb-branch__meta">
                    {!isMain && (
                      <span className={`wb-status wb-status--${b.status}`}>{STATUS_WORD[b.status] ?? b.status}</span>
                    )}
                    <span className={`wb-ready wb-ready--${ready.tone}`} title={ready.label}>
                      <span className="sr-only">{ready.label}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
