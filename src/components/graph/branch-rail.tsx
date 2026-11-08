'use client';

import { GitBranch, Lock, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { laneColor, nodeBadge } from '@/components/status';
import type { BranchView, GraphView } from '@/lib/demo/view';

export interface BranchRailProps {
  readonly branches: readonly BranchView[];
  readonly graph: GraphView;
  readonly selectedOid: string | null;
  readonly comparedOid: string | null;
  readonly onSelect: (oid: string) => void;
  readonly onCompare: (oid: string) => void;
}

export function BranchRail({
  branches,
  graph,
  selectedOid,
  comparedOid,
  onSelect,
  onCompare,
}: BranchRailProps) {
  const laneOf = new Map(graph.nodes.map((n) => [n.oid, n.lane]));
  const nodeOf = new Map(graph.nodes.map((n) => [n.oid, n]));

  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Branches">
      <h2 className="px-1.5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        Refs
      </h2>
      <ul className="flex flex-col gap-0.5">
        {branches.map((branch) => {
          const node = nodeOf.get(branch.tip);
          const look = nodeBadge({
            status: branch.status,
            isMerge: node?.isMerge ?? false,
            isRoot: node?.isRoot ?? false,
          });
          const lane = laneOf.get(branch.tip) ?? 0;
          const isSelected = branch.tip === selectedOid;
          const isCompared = branch.tip === comparedOid;
          return (
            <li key={branch.name}>
              <div
                className={`group/ref flex items-start gap-2 rounded-md px-1.5 py-1.5 transition-colors ${
                  isSelected ? 'bg-accent' : 'hover:bg-accent/60'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(branch.tip)}
                  className="flex min-w-0 flex-1 flex-col items-start gap-1 rounded-md text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  aria-label={`${branch.name}, tip ${branch.shortTip}, ${look.label}. Reveal in graph.`}
                >
                  <span className="flex w-full min-w-0 items-center gap-1.5">
                    <GitBranch
                      className="size-3.5 shrink-0"
                      style={{ color: laneColor(lane) }}
                      aria-hidden="true"
                    />
                    <span className="truncate font-mono text-[11.5px] font-medium">
                      {branch.name}
                    </span>
                    {branch.isHead && (
                      <span className="hairline ml-auto shrink-0 rounded-sm border px-1 text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">
                        head
                      </span>
                    )}
                  </span>
                  <span className="flex w-full min-w-0 items-center gap-1.5">
                    <span
                      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-[9.5px] font-semibold tracking-wide uppercase ${look.pill}`}
                    >
                      <look.Icon className="size-3" aria-hidden="true" />
                      {look.short}
                    </span>
                    <code className="shrink-0 font-mono text-[10px] text-muted-foreground tnum">
                      {branch.shortTip}
                    </code>
                    {branch.ahead > 0 ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground tnum">
                        +{branch.ahead} ahead
                      </span>
                    ) : (
                      !branch.isHead && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-pass">
                          <Check className="size-3" aria-hidden="true" />
                          merged
                        </span>
                      )
                    )}
                  </span>
                  {branch.mergeBlockedReason !== null && (
                    <span className="flex items-start gap-1 text-[10.5px] leading-snug text-muted-foreground">
                      <Lock className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                      <span className="line-clamp-2">{branch.mergeBlockedReason}</span>
                    </span>
                  )}
                </button>
                {!branch.isHead && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant={isCompared ? 'secondary' : 'ghost'}
                          size="xs"
                          className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover/ref:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100"
                          aria-pressed={isCompared}
                          onClick={() => onCompare(branch.tip)}
                          aria-label={
                            isCompared
                              ? `Stop comparing ${branch.name}`
                              : `Pick ${branch.name} as the branch to merge`
                          }
                        >
                          {isCompared ? 'picked' : 'pick'}
                        </Button>
                      }
                    />
                    <TooltipContent side="right">
                      {isCompared ? 'Unpick this branch' : 'Pick as the branch to merge in'}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
