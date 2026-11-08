'use client';

/**
 * The triptych.
 *
 * Left: the branch tree, read as a source-control sidebar.
 * Centre: the gene-track minimap and the three-register diff.
 * Right: the seven agent checks as a CI run on a pull request.
 * Bottom: a terminal-style panel holding the cell canvas, the red-team
 * console and the raw delta trail — tools, not heroes.
 *
 * All state that the server owns (repository, screen verdicts, pipeline runs)
 * is fetched through the server actions in `src/app/actions.ts`. This
 * component holds only view state.
 */

import {
  ChevronsUpDown,
  CircleDot,
  Dna,
  FlaskConical,
  GitBranch,
  Info,
  ListTree,
  Maximize2,
  Minimize2,
  ScanSearch,
  Swords,
  Target,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  attemptMergeAction,
  runPipelineAction,
  signOffAction,
} from '@/app/actions';
import { CiPanel } from '@/components/agents/ci-panel';
import { CellCanvas } from '@/components/cell/cell-canvas';
import { DiffStack } from '@/components/diff/diff-stack';
import { GeneTrack, type CodonTick, type TrackZoom } from '@/components/genome-map/gene-track';
import { RedTeamConsole } from '@/components/redteam/redteam-console';
import { BranchTree } from '@/components/shell/branch-tree';
import { CommandPalette } from '@/components/shell/command-palette';
import { CHECK_STATUS_STYLE } from '@/components/shell/status';
import { Titlebar } from '@/components/shell/titlebar';
import { setTheme } from '@/components/shell/use-theme';
import { Button } from '@/components/ui/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { MergeDecision, PipelineRun } from '@/lib/agents';
import type { WorkspaceSnapshot } from '@/lib/workspace';

type PanelTab = 'canvas' | 'redteam' | 'trail';

export interface WorkbenchProps {
  readonly workspace: WorkspaceSnapshot;
}

export function Workbench({ workspace }: WorkbenchProps) {
  const [activeBranch, setActiveBranch] = useState(workspace.defaultBranch);
  const [expanded, setExpanded] = useState<readonly string[]>([workspace.defaultBranch]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>('canvas');
  const [zoom, setZoom] = useState<TrackZoom>('exon');
  const [trackExpanded, setTrackExpanded] = useState(false);
  const [changesOnly, setChangesOnly] = useState(false);
  const [focusCodon, setFocusCodon] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const [runs, setRuns] = useState<Readonly<Record<string, PipelineRun>>>({});
  const [merges, setMerges] = useState<Readonly<Record<string, MergeDecision>>>({});
  const [mergeVcs, setMergeVcs] = useState<Readonly<Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const branch = useMemo(
    () => workspace.branches.find((b) => b.name === activeBranch) ?? workspace.branches[0],
    [workspace.branches, activeBranch],
  );

  const run = runs[branch.name] ?? null;
  const merge = merges[branch.name] ?? null;

  const ticks: readonly CodonTick[] = useMemo(
    () =>
      branch.diff.map((row) => ({
        codonIndex: row.codonIndex,
        refAa: row.refAa,
        altAa: row.altAa,
        changed: row.status !== 'same',
        silent: row.silent,
      })),
    [branch.diff],
  );

  const selectBranch = useCallback((name: string) => {
    setActiveBranch(name);
    setExpanded((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setError(null);
  }, []);

  const runPipeline = useCallback(
    (requestText?: string) => {
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          const result = await runPipelineAction(branch.name, requestText);
          setRuns((prev) => ({ ...prev, [branch.name]: result.run }));
          setMerges((prev) => ({ ...prev, [branch.name]: result.merge }));
          setMergeVcs((prev) => {
            const next = { ...prev };
            delete next[branch.name];
            return next;
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : 'the pipeline could not be run');
        } finally {
          setBusy(false);
        }
      })();
    },
    [branch.name],
  );

  const signOff = useCallback(
    (approver: string) => {
      if (run === null) return;
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          const result = await signOffAction(run.id, approver);
          setRuns((prev) => ({ ...prev, [branch.name]: result.run }));
          setMerges((prev) => ({ ...prev, [branch.name]: result.merge }));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'the sign-off could not be recorded');
        } finally {
          setBusy(false);
        }
      })();
    },
    [branch.name, run],
  );

  const attemptMerge = useCallback(() => {
    if (run === null) {
      setError('Run the checks before attempting a merge — the gate decides, not the button.');
      setPanelOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const result = await attemptMergeAction(run.id);
        setMerges((prev) => ({ ...prev, [branch.name]: result.decision }));
        setMergeVcs((prev) => {
          const next = { ...prev };
          if (result.vcs === null) delete next[branch.name];
          else next[branch.name] = result.vcs;
          return next;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'the merge could not be attempted');
      } finally {
        setBusy(false);
      }
    })();
  }, [branch.name, run]);

  const jumpToEdit = useCallback(() => {
    const target =
      branch.editCodonIndex ?? branch.diff.find((r) => r.status !== 'same')?.codonIndex ?? null;
    if (target === null) return;
    setFocusCodon(target);
    setZoom('codon');
  }, [branch.editCodonIndex, branch.diff]);

  const toggleTheme = useCallback(() => {
    setTheme(!document.documentElement.classList.contains('dark'));
  }, []);

  // Keyboard-first: the palette and the commands it lists are all bound.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();

      // ⌘K opens the palette from anywhere, including a text field.
      if (key === 'k') {
        event.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      // Every other shortcut yields to the field the user is typing in. The
      // red-team console binds ⌘↵ to "screen this text"; without this guard
      // the same keystroke would also start a pipeline run on the branch's
      // default request, so a blocked verdict and a passing run would appear
      // side by side — exactly the impression SPEC §7.4 forbids.
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      if (key === 'enter') {
        event.preventDefault();
        runPipeline();
        return;
      }
      if (key === 'g') {
        event.preventDefault();
        jumpToEdit();
        return;
      }
      if (event.shiftKey && key === 'm') {
        event.preventDefault();
        attemptMerge();
        return;
      }
      if (event.shiftKey && key === 'r') {
        event.preventDefault();
        setPanelOpen(true);
        setPanelTab('redteam');
        return;
      }
      if (event.shiftKey && key === 'c') {
        event.preventDefault();
        setPanelOpen(true);
        setPanelTab('canvas');
        return;
      }
      if (key === 'j') {
        event.preventDefault();
        setPanelOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runPipeline, jumpToEdit, attemptMerge]);

  const runStatusFor = useCallback(
    (name: string) => {
      const r = runs[name];
      if (r === undefined) return null;
      const style =
        r.conclusion === 'blocked'
          ? CHECK_STATUS_STYLE.blocked
          : r.conclusion === 'escalated'
            ? CHECK_STATUS_STYLE.escalated
            : r.conclusion === 'failed'
              ? CHECK_STATUS_STYLE.fail
              : CHECK_STATUS_STYLE.pass;
      return { label: r.conclusion, fg: style.fg, icon: style.icon };
    },
    [runs],
  );

  const markerCodon = branch.editCodonIndex;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Titlebar
        gene={workspace.gene}
        geneName={workspace.geneName}
        branch={branch.name}
        baseBranch={branch.baseBranch}
        headShort={branch.headShort}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={panelOpen ? '68%' : '100%'} minSize="30%">
          <ResizablePanelGroup orientation="horizontal" className="min-h-0">
            {/* ── Left: branch tree ───────────────────────────────────── */}
            <ResizablePanel defaultSize="21%" minSize="13%" className="min-w-0">
              <div className="vibrancy flex h-full min-h-0 flex-col border-r border-chrome-border">
                <BranchTree
                  branches={workspace.branches}
                  activeBranch={branch.name}
                  expanded={expanded}
                  onSelect={selectBranch}
                  onToggle={(name) =>
                    setExpanded((prev) =>
                      prev.includes(name) ? prev.filter((b) => b !== name) : [...prev, name],
                    )
                  }
                  runStatusFor={runStatusFor}
                />
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* ── Centre: gene track + diff ───────────────────────────── */}
            <ResizablePanel defaultSize="51%" minSize="28%" className="min-w-0">
              <div className="flex h-full min-h-0 flex-col bg-card">
                {/* Gene-track minimap strip, always visible above the diff. */}
                <div className="shrink-0 border-b border-border bg-gutter">
                  <div className="flex items-center gap-2 px-2.5 pt-1.5">
                    <Dna className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                    <h2 className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                      {workspace.gene} locus
                    </h2>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      chr{workspace.chromosome} · {workspace.exons.length} exons ·{' '}
                      {workspace.totalCodonCount} codons · {workspace.provenance}
                    </span>

                    <ToggleGroup
                      value={[zoom]}
                      onValueChange={(value) => {
                        const next = Array.isArray(value) ? value[0] : value;
                        if (next !== 'locus' && next !== 'exon' && next !== 'codon') return;
                        setZoom(next);
                        // The compact strip is pinned to the whole locus, so
                        // choosing a zoom has to open the full track or the
                        // control does nothing visible.
                        setTrackExpanded(true);
                      }}
                      className="ml-auto shrink-0"
                      aria-label="Gene track zoom"
                    >
                      <ToggleGroupItem value="locus" aria-label="Zoom to whole locus" className="h-6 px-1.5 text-[10px]">
                        locus
                      </ToggleGroupItem>
                      <ToggleGroupItem value="exon" aria-label="Zoom to modelled exon" className="h-6 px-1.5 text-[10px]">
                        exon
                      </ToggleGroupItem>
                      <ToggleGroupItem value="codon" aria-label="Zoom to codon level" className="h-6 px-1.5 text-[10px]">
                        codon
                      </ToggleGroupItem>
                    </ToggleGroup>

                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => setTrackExpanded((v) => !v)}
                      aria-expanded={trackExpanded}
                      aria-label={
                        trackExpanded ? 'Collapse gene track to minimap' : 'Expand the full gene track'
                      }
                    >
                      {trackExpanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
                    </Button>
                  </div>

                  <div className="px-2.5 pb-1.5">
                    <GeneTrack
                      gene={workspace.gene}
                      chromosome={workspace.chromosome}
                      exons={workspace.exons}
                      modelledCodonCount={workspace.modelledCodonCount}
                      totalCodonCount={workspace.totalCodonCount}
                      markerCodon={markerCodon}
                      zoom={trackExpanded ? zoom : 'locus'}
                      ticks={ticks}
                      compact={!trackExpanded}
                      onSeek={(codon) => {
                        setFocusCodon(codon);
                        if (!trackExpanded) setTrackExpanded(true);
                      }}
                    />
                    {trackExpanded && (
                      <div className="mt-1 space-y-1">
                        <p className="flex items-start gap-1.5 text-[10px] leading-snug text-muted-foreground">
                          <Info className="mt-[1px] size-3 shrink-0" aria-hidden />
                          <span>
                            {workspace.locusNote} Exon boundaries and codon positions come from the
                            curated fixture; the structural annotations attached to each variant are
                            illustrative teaching summaries, not predictions from a validated model.
                          </span>
                        </p>
                        <p className="pl-[1.125rem] text-[10px] leading-snug text-muted-foreground">
                          {workspace.fixtureDisclaimer}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Diff toolbar. */}
                <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-1">
                  <GitBranch className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate font-mono text-[11px]">
                    {branch.refSequence.label}
                    <span className="text-muted-foreground"> → </span>
                    {branch.altSequence.label}
                  </span>
                  <Toggle
                    pressed={changesOnly}
                    onPressedChange={setChangesOnly}
                    className="ml-auto h-6 shrink-0 gap-1 px-1.5 text-[10px]"
                    aria-label="Show changed codons only"
                  >
                    <ChevronsUpDown aria-hidden />
                    changes only
                  </Toggle>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={jumpToEdit}
                    disabled={markerCodon === null}
                    className="shrink-0 text-[10px]"
                  >
                    <Target aria-hidden />
                    jump to edit
                  </Button>
                </div>

                <DiffStack
                  rows={branch.diff}
                  refLabel={branch.refSequence.label}
                  altLabel={branch.altSequence.label}
                  focusCodon={focusCodon}
                  onFocusCodon={setFocusCodon}
                  changesOnly={changesOnly}
                />
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* ── Right: CI panel ─────────────────────────────────────── */}
            <ResizablePanel defaultSize="28%" minSize="18%" className="min-w-0">
              <div className="vibrancy flex h-full min-h-0 flex-col border-l border-chrome-border">
                <CiPanel
                  run={run}
                  merge={merge}
                  mergeVcs={mergeVcs[branch.name] ?? null}
                  mergeTarget={branch.baseBranch}
                  branch={branch.name}
                  busy={busy}
                  onRun={() => runPipeline()}
                  onSignOff={signOff}
                  onAttemptMerge={attemptMerge}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        {panelOpen && <ResizableHandle withHandle />}

        {/* ── Bottom: terminal-style panel ─────────────────────────────── */}
        {panelOpen && (
          <ResizablePanel defaultSize="32%" minSize="14%">
            <section
              aria-label="Tools panel"
              className="flex h-full min-h-0 flex-col border-t border-chrome-border bg-card"
            >
              <div
                role="tablist"
                aria-label="Tools"
                className="flex shrink-0 items-center gap-0 border-b border-border bg-gutter px-1.5"
              >
                {(
                  [
                    { id: 'canvas', label: 'Cell canvas', icon: FlaskConical },
                    { id: 'redteam', label: 'Red team', icon: Swords },
                    { id: 'trail', label: 'Delta trail', icon: ListTree },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  const selected = panelTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      id={`tab-${tab.id}`}
                      aria-selected={selected}
                      aria-controls={`tabpanel-${tab.id}`}
                      onClick={() => setPanelTab(tab.id)}
                      className={`flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[11px] ${
                        selected
                          ? 'border-primary text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Icon className="size-3" aria-hidden />
                      {tab.label}
                    </button>
                  );
                })}
                <span className="nums ml-auto pr-1.5 font-mono text-[10px] text-muted-foreground">
                  ⌘J toggles this panel
                </span>
              </div>

              <div
                role="tabpanel"
                id={`tabpanel-${panelTab}`}
                aria-labelledby={`tab-${panelTab}`}
                className="flex min-h-0 flex-1 flex-col overflow-y-auto"
              >
                {panelTab === 'canvas' && (
                  <CellCanvas
                    key={branch.name}
                    genotypeLabel={branch.genotypeLabel}
                    polymerizationTendency={branch.polymerizationTendency}
                    defaults={workspace.simulation}
                    pO2Control={workspace.pO2}
                    simulationNote={workspace.simulationNote}
                  />
                )}

                {panelTab === 'redteam' && (
                  <RedTeamConsole
                    onRunPipeline={(requestText) => runPipeline(requestText)}
                    pipelineBusy={busy}
                  />
                )}

                {panelTab === 'trail' && <DeltaTrail run={run} />}
              </div>
            </section>
          </ResizablePanel>
        )}
      </ResizablePanelGroup>

      {/* Status bar. */}
      <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-chrome-border bg-chrome px-2.5 font-mono text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <GitBranch className="size-2.5" aria-hidden />
          {branch.name}
        </span>
        <span className="nums">{branch.headShort}</span>
        <span className="nums">
          {branch.diff.filter((r) => r.status !== 'same').length} changed /{' '}
          {branch.diff.length} codons
        </span>
        <span className="nums">
          {markerCodon === null ? 'no edit' : `codon ${markerCodon}`}
        </span>
        {run !== null && <span className="nums">{run.gate.category}</span>}
        {error !== null && (
          <span className="truncate text-status-fail" role="alert">
            {error}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1">
          <CircleDot className="size-2.5" aria-hidden />
          illustrative simulation — not a clinical tool
        </span>
      </footer>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        branches={workspace.branches}
        activeBranch={branch.name}
        markerCodon={markerCodon}
        onSelectBranch={selectBranch}
        onRunPipeline={() => runPipeline()}
        onJumpToEdit={jumpToEdit}
        onAttemptMerge={attemptMerge}
        onOpenRedTeam={() => {
          setPanelOpen(true);
          setPanelTab('redteam');
        }}
        onOpenCanvas={() => {
          setPanelOpen(true);
          setPanelTab('canvas');
        }}
        onZoom={(z) => {
          setZoom(z);
          setTrackExpanded(true);
        }}
        onToggleTheme={toggleTheme}
      />
    </div>
  );
}

/**
 * The append-only delta trail, raw. This is the artifact SPEC §2 says the
 * tool exists to produce, so it is inspectable rather than summarised.
 *
 * Payloads are rendered as JSON, which is safe precisely because the gate
 * never puts request text into a payload — a blocked run's `screen` delta
 * holds a category, a generic reason and a digest.
 */
function DeltaTrail({ run }: { readonly run: PipelineRun | null }) {
  if (run === null) {
    return (
      <p className="px-3 py-3 text-[11.5px] text-muted-foreground">
        No run on this branch yet. The trail is append-only: a re-run forks the record rather than
        overwriting it, which is why disagreement between agents stays visible.
      </p>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <p className="mb-2 flex items-start gap-1.5 text-[10px] leading-snug text-muted-foreground">
        <ScanSearch className="mt-[1px] size-3 shrink-0" aria-hidden />
        <span>
          {run.deltas.length} deltas for <span className="font-mono">{run.id}</span>. Each is
          attributed and parented; no delta is ever rewritten. Refused request text appears nowhere
          in this trail by construction — the gate records a category and a one-way digest instead.
        </span>
      </p>
      <ol className="space-y-1.5">
        {run.deltas.map((delta) => (
          <li key={delta.id} className="rounded-md border border-border bg-gutter/60 px-2 py-1.5">
            <p className="nums flex flex-wrap items-center gap-x-2 font-mono text-[10.5px]">
              <span className="rounded-sm border border-border bg-card px-1 text-[9.5px] uppercase">
                {delta.kind}
              </span>
              <span className="text-foreground">{delta.author}</span>
              <span className="text-muted-foreground">{delta.subject}</span>
              <span className="ml-auto text-muted-foreground">{delta.id}</span>
            </p>
            <pre className="mt-1 overflow-x-auto font-mono text-[10px] leading-snug text-muted-foreground">
              {JSON.stringify(delta.payload, null, 1)}
            </pre>
          </li>
        ))}
      </ol>
    </div>
  );
}
