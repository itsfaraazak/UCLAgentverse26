'use client';

/**
 * The left pane: a source-control sidebar.
 *
 * Real branches from `lib/vcs`, each with its own commit list, and the DAG's
 * shape implied by indentation rather than drawn as a graph — the
 * `variant/graph-first` branch is the one that draws the graph.
 */

import {
  ChevronRight,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Star,
  type LucideIcon,
} from 'lucide-react';

import type { BranchView } from '@/lib/workspace';

export interface BranchTreeProps {
  readonly branches: readonly BranchView[];
  readonly activeBranch: string;
  readonly expanded: readonly string[];
  readonly onSelect: (branch: string) => void;
  readonly onToggle: (branch: string) => void;
  readonly runStatusFor: (branch: string) => { readonly label: string; readonly fg: string; readonly icon: LucideIcon } | null;
}

function tendencyTone(t: number): string {
  if (t >= 0.5) return 'text-status-fail';
  if (t > 0) return 'text-status-warn';
  return 'text-status-pass';
}

export function BranchTree({
  branches,
  activeBranch,
  expanded,
  onSelect,
  onToggle,
  runStatusFor,
}: BranchTreeProps) {
  return (
    <nav aria-label="Branches" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <h2 className="sticky top-0 z-10 flex shrink-0 items-center gap-1.5 border-b border-chrome-border bg-chrome px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        <GitBranch className="size-3.5" aria-hidden />
        Branches
        <span className="nums ml-auto text-[10px] font-normal">{branches.length}</span>
      </h2>

      <ul className="flex-1 py-1">
        {branches.map((branch) => {
          const isActive = branch.name === activeBranch;
          const isOpen = expanded.includes(branch.name);
          const status = runStatusFor(branch.name);
          const StatusIcon = status?.icon;

          return (
            <li key={branch.name}>
              <div
                className={`group flex items-center gap-0.5 pr-1.5 ${
                  isActive ? 'bg-accent' : 'hover:bg-muted/60'
                }`}
                style={{ paddingLeft: `${0.25 + branch.depth * 0.75}rem` }}
              >
                <button
                  type="button"
                  onClick={() => onToggle(branch.name)}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? 'Collapse' : 'Expand'} commits on ${branch.name}`}
                  className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight
                    className={`size-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    aria-hidden
                  />
                </button>

                <button
                  type="button"
                  onClick={() => onSelect(branch.name)}
                  aria-current={isActive ? 'true' : undefined}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-1 text-left"
                >
                  <GitBranch
                    className={`size-3.5 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
                    aria-hidden
                  />
                  <span
                    className={`truncate font-mono text-[12px] ${
                      isActive ? 'font-semibold text-accent-foreground' : 'text-foreground'
                    }`}
                    title={branch.name}
                  >
                    {branch.name}
                  </span>
                  {branch.isDefault && (
                    <Star
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-label="default branch"
                    />
                  )}
                </button>

                {status !== null && StatusIcon !== undefined && (
                  <span
                    className={`shrink-0 ${status.fg}`}
                    title={`last run on this branch: ${status.label}`}
                  >
                    <StatusIcon className="size-3.5" aria-hidden />
                    <span className="sr-only">last run: {status.label}</span>
                  </span>
                )}
              </div>

              {isActive && (
                <p
                  className="pr-3 pb-1.5 text-[11px] leading-snug text-muted-foreground"
                  style={{ paddingLeft: `${1.5 + branch.depth * 0.75}rem` }}
                >
                  {branch.description}
                </p>
              )}

              {isOpen && (
                <ul
                  className="border-l border-chrome-border pb-1"
                  style={{ marginLeft: `${1.1 + branch.depth * 0.75}rem` }}
                >
                  {branch.commits.map((commit) => (
                    <li key={commit.oid} className="flex items-start gap-1.5 py-[3px] pl-2 pr-2">
                      <GitCommitHorizontal
                        className="mt-px size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] leading-tight text-foreground">
                          {commit.message}
                        </span>
                        <span className="nums block font-mono text-[10px] leading-tight text-muted-foreground">
                          {commit.short}
                          {commit.parents.length > 1 && (
                            <GitMerge className="ml-1 inline size-3 align-[-2px]" aria-label="merge commit" />
                          )}
                          {commit.editCodonIndex !== null && ` · codon ${commit.editCodonIndex}`}
                        </span>
                      </span>
                    </li>
                  ))}
                  <li
                    className="mt-1 ml-2 border-t border-chrome-border/60 pt-1 pr-2 text-[10px] text-muted-foreground"
                  >
                    <span className="block">
                      genotype{' '}
                      <span className="font-mono text-foreground">{branch.genotypeLabel}</span>
                    </span>
                    <span className="block">
                      polymerisation tendency{' '}
                      <span className={`nums ${tendencyTone(branch.polymerizationTendency)}`}>
                        {branch.polymerizationTendency.toFixed(2)}
                      </span>
                    </span>
                  </li>
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <p className="shrink-0 border-t border-chrome-border px-2.5 py-2 text-[10px] leading-snug text-muted-foreground">
        Object ids are <span className="font-mono">sha256</span> over canonical JSON, shortened to
        12 characters. The same fixture always produces the same ids.
      </p>
    </nav>
  );
}
