'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GitCommitHorizontal,
  GitMerge,
  Maximize2,
  Minus,
  Plus,
  Tag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { laneColor, nodeBadge } from '@/components/status';
import type { CommitView, GraphView } from '@/lib/demo/view';

const NODE_RADIUS = 9;
const RING_WIDTH = 3.5;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.2;
/** Width reserved to the right of the lanes for each commit's label block. */
const LABEL_GUTTER = 430;

export interface CommitGraphProps {
  readonly graph: GraphView;
  readonly commits: readonly CommitView[];
  readonly selectedOid: string | null;
  readonly comparedOid: string | null;
  readonly onSelect: (oid: string) => void;
  readonly onOpen: (oid: string) => void;
  readonly onCompare: (oid: string) => void;
}

export function CommitGraph({
  graph,
  commits,
  selectedOid,
  comparedOid,
  onSelect,
  onOpen,
  onCompare,
}: CommitGraphProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const byOid = useMemo(() => new Map(commits.map((c) => [c.oid, c])), [commits]);
  const order = useMemo(() => graph.nodes.map((n) => n.oid), [graph.nodes]);

  const laneSpan = graph.width;
  const contentWidth = laneSpan + LABEL_GUTTER;

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // ── Pan by dragging the background ──────────────────────────────────────
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      // Let clicks on a commit row through; only the backdrop pans.
      if (target.closest('[data-commit-row]') !== null) return;
      dragState.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [pan.x, pan.y],
  );

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragState.current;
    if (start === null) return;
    setPan({
      x: start.panX + (event.clientX - start.x),
      y: start.panY + (event.clientY - start.y),
    });
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  // ── Keyboard navigation between nodes (SPEC §5: never mouse-only) ───────
  const moveSelection = useCallback(
    (delta: number) => {
      if (order.length === 0) return;
      const current = selectedOid === null ? -1 : order.indexOf(selectedOid);
      const next = Math.min(order.length - 1, Math.max(0, current + delta));
      const oid = order[next];
      if (oid !== undefined) onSelect(oid);
    },
    [order, selectedOid, onSelect],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'ArrowDown':
        case 'j':
          event.preventDefault();
          moveSelection(1);
          break;
        case 'ArrowUp':
        case 'k':
          event.preventDefault();
          moveSelection(-1);
          break;
        case 'Home':
          event.preventDefault();
          if (order[0] !== undefined) onSelect(order[0]);
          break;
        case 'End':
          event.preventDefault();
          if (order[order.length - 1] !== undefined) onSelect(order[order.length - 1]);
          break;
        case 'Enter':
        case ' ':
          if (selectedOid !== null) {
            event.preventDefault();
            onOpen(selectedOid);
          }
          break;
        case 'c':
          if (selectedOid !== null) {
            event.preventDefault();
            onCompare(selectedOid);
          }
          break;
        case '+':
        case '=':
          event.preventDefault();
          setZoom((z) => Math.min(MAX_ZOOM, z + 0.15));
          break;
        case '-':
          event.preventDefault();
          setZoom((z) => Math.max(MIN_ZOOM, z - 0.15));
          break;
        case '0':
          event.preventDefault();
          reset();
          break;
        default:
          break;
      }
    },
    [moveSelection, onCompare, onOpen, onSelect, order, reset, selectedOid],
  );

  // Keep the selected row in view when the selection moves by keyboard.
  useEffect(() => {
    if (selectedOid === null) return;
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const row = scroller.querySelector(`[data-oid="${selectedOid}"]`);
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedOid]);

  return (
    <section className="relative flex min-h-0 flex-1 flex-col" aria-label="Commit history graph">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-card px-4">
        <h2 className="text-[13px] font-semibold tracking-tight">History</h2>
        <span className="text-[12px] text-muted-foreground tnum">
          {graph.rowCount} commits · {graph.laneCount} lanes
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Zoom out"
                  onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 0.15))}
                  disabled={zoom <= MIN_ZOOM}
                >
                  <Minus />
                </Button>
              }
            />
            <TooltipContent side="bottom">Zoom out (−)</TooltipContent>
          </Tooltip>
          <span className="w-11 text-center font-mono text-[11px] text-muted-foreground tnum">
            {Math.round(zoom * 100)}%
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Zoom in"
                  onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.15))}
                  disabled={zoom >= MAX_ZOOM}
                >
                  <Plus />
                </Button>
              }
            />
            <TooltipContent side="bottom">Zoom in (+)</TooltipContent>
          </Tooltip>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Reset view" onClick={reset}>
                  <Maximize2 />
                </Button>
              }
            />
            <TooltipContent side="bottom">Reset view (0)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Canvas ──────────────────────────────────────────────────────── */}
      <div
        ref={scrollerRef}
        role="tree"
        tabIndex={0}
        aria-label={`Commit graph: ${graph.rowCount} commits across ${graph.laneCount} lanes. Use the up and down arrow keys to move between commits, Enter to open the inspector, and C to pick a branch tip to compare.`}
        aria-activedescendant={selectedOid === null ? undefined : `commit-${selectedOid}`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative min-h-0 flex-1 cursor-grab overflow-auto focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:-outline-offset-2 active:cursor-grabbing"
        style={{
          backgroundImage:
            'radial-gradient(var(--graph-grid) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        <div
          className="relative origin-top-left transition-transform duration-150 ease-out"
          style={{
            width: contentWidth,
            height: graph.height + 40,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <GraphEdges graph={graph} selectedOid={selectedOid} />
          {graph.nodes.map((node) => {
            const commit = byOid.get(node.oid);
            if (commit === undefined) return null;
            return (
              <CommitRow
                key={node.oid}
                commit={commit}
                x={node.x}
                y={node.y}
                lane={node.lane}
                row={node.row}
                total={graph.rowCount}
                laneSpan={laneSpan}
                isSelected={node.oid === selectedOid}
                isCompared={node.oid === comparedOid}
                onSelect={onSelect}
                onOpen={onOpen}
              />
            );
          })}
        </div>
      </div>

      {/* ── Text alternative: the same ancestry, readable without the SVG ─ */}
      <details className="shrink-0 border-t bg-card text-[12px]">
        <summary className="cursor-pointer px-4 py-2 font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          Text description of the graph
        </summary>
        <ol className="max-h-44 space-y-1 overflow-auto px-4 pb-3 text-muted-foreground">
          {graph.description.map((line, index) => (
            <li key={index} className="leading-relaxed">
              {line}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

function GraphEdges({
  graph,
  selectedOid,
}: {
  readonly graph: GraphView;
  readonly selectedOid: string | null;
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 overflow-visible"
      width={graph.width}
      height={graph.height + 40}
      aria-hidden="true"
      focusable="false"
    >
      {/* Edges first, so nodes sit on top of the lines. */}
      {graph.edges.map((edge) => {
        const active = selectedOid !== null && (edge.from === selectedOid || edge.to === selectedOid);
        return (
          <path
            key={edge.id}
            d={edge.path}
            fill="none"
            stroke={laneColor(edge.lane)}
            strokeWidth={active ? 2.75 : 1.9}
            strokeLinecap="round"
            opacity={selectedOid === null ? 0.85 : active ? 1 : 0.4}
            strokeDasharray={edge.kind === 'merge' ? '0.1 5.5' : undefined}
            className="transition-[stroke-width,opacity] duration-150"
          />
        );
      })}
    </svg>
  );
}

interface CommitRowProps {
  readonly commit: CommitView;
  readonly x: number;
  readonly y: number;
  readonly lane: number;
  readonly row: number;
  readonly total: number;
  readonly laneSpan: number;
  readonly isSelected: boolean;
  readonly isCompared: boolean;
  readonly onSelect: (oid: string) => void;
  readonly onOpen: (oid: string) => void;
}

function CommitRow({
  commit,
  x,
  y,
  lane,
  row,
  total,
  laneSpan,
  isSelected,
  isCompared,
  onSelect,
  onOpen,
}: CommitRowProps) {
  const look = nodeBadge(commit);
  const ring = look.color;
  const needsAttention = commit.status === 'blocked' || commit.status === 'escalated' || commit.status === 'fail';

  return (
    <div
      data-commit-row
      data-oid={commit.oid}
      id={`commit-${commit.oid}`}
      role="treeitem"
      aria-level={1}
      aria-posinset={row + 1}
      aria-setsize={total}
      aria-selected={isSelected}
      aria-label={`${commit.short}. ${commit.message}. ${look.label}.${
        commit.branches.length > 0 ? ` Branch tip: ${commit.branches.join(', ')}.` : ''
      }`}
      className="absolute flex items-center"
      style={{ top: y - 26, left: 0, height: 52 }}
    >
      {/* The node glyph, positioned on its lane. */}
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onSelect(commit.oid)}
        onDoubleClick={() => onOpen(commit.oid)}
        aria-hidden="true"
        className="absolute flex items-center justify-center rounded-full"
        style={{ left: x - 20, top: 6, width: 40, height: 40 }}
      >
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          {/* Selection halo */}
          {isSelected && (
            <circle cx="20" cy="20" r={NODE_RADIUS + 7} fill={ring} opacity={0.16} />
          )}
          {isCompared && (
            <circle
              cx="20"
              cy="20"
              r={NODE_RADIUS + 7}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={1.5}
              strokeDasharray="3 2.5"
            />
          )}
          {/* A blocked or escalated commit also gets a second outer ring, so
              it is legible from the graph without relying on colour alone. */}
          {needsAttention && (
            <circle
              cx="20"
              cy="20"
              r={NODE_RADIUS + 4}
              fill="none"
              stroke={ring}
              strokeWidth={1.25}
              opacity={0.55}
              strokeDasharray={commit.status === 'escalated' ? '2.5 2.5' : undefined}
            />
          )}
          {/* Status ring */}
          <circle
            cx="20"
            cy="20"
            r={NODE_RADIUS}
            fill="var(--card)"
            stroke={ring}
            strokeWidth={RING_WIDTH}
          />
          {/* Merge commits get a hollow centre; others a solid dot. */}
          {commit.isMerge ? (
            <circle cx="20" cy="20" r={2.75} fill={ring} opacity={0.5} />
          ) : commit.isRoot ? (
            <circle cx="20" cy="20" r={3.5} fill={ring} />
          ) : null}
        </svg>
      </button>

      {/* The label block, to the right of every lane. */}
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onSelect(commit.oid)}
        onDoubleClick={() => onOpen(commit.oid)}
        className={`absolute flex max-w-[400px] flex-col gap-1 rounded-lg border px-3 py-1.5 text-left transition-colors ${
          isSelected
            ? 'border-ring/60 bg-card'
            : 'border-transparent hover:border-border hover:bg-accent/50'
        }`}
        style={{ left: laneSpan + 14, top: 0 }}
      >
        <span className="flex items-center gap-2">
          <code className="shrink-0 font-mono text-[11px] text-muted-foreground tnum">
            {commit.short}
          </code>
          {commit.isMerge && (
            <GitMerge className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          {commit.isRoot && (
            <GitCommitHorizontal
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <span className="truncate text-[13px] font-medium">{commit.message}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase ${look.pill}`}
          >
            <look.Icon className="size-3" aria-hidden="true" />
            {look.short}
          </span>
          {commit.branches.map((name) => (
            <span
              key={name}
              className="inline-flex max-w-[180px] items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[10px]"
              style={{ borderColor: laneColor(lane), color: laneColor(lane) }}
            >
              <Tag className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{name}</span>
            </span>
          ))}
          {commit.edit !== null && (
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {commit.edit.gene} codon {commit.edit.codonIndex}{' '}
              <span className="seq">
                {commit.edit.refCodon}→{commit.edit.altCodon}
              </span>
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
