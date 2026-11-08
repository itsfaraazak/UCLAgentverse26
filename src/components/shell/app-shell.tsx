'use client';

/**
 * The application shell: the frame every other surface lives inside.
 *
 * Three columns — branch rail ∥ agent run / console ∥ workspace — in a
 * 100dvh grid that does not scroll; each column scrolls independently. Both
 * side columns collapse, and below 68rem the grid drops to a single pane with
 * a switcher, because a judge may open this on a laptop at an odd resolution.
 *
 * All data arrives as a prop. This component holds only *view* state: which
 * branch is selected, which tab is open, which panes are collapsed. Nothing
 * on screen is computed here.
 *
 * Created genotype lines are *not* view state. They live in the URL as
 * repeated `line` params, the server replays them, and the result arrives
 * here as a prop — so leaving for `/ide`, `/bench` or `/graph` and coming
 * back, or reloading, keeps them. See `model/overlay-url.ts`.
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Columns3, GitBranch, Terminal } from 'lucide-react';

import './shell.css';

import type { BranchSpec, ScreenView, WorkspaceView } from './model/types';
import type { ShellCommand } from './model/commands';
import { SURFACES } from './model/surfaces';
import { withOverlay } from './model/overlay-url';
import { BranchRail } from './branch-rail';
import { AgentConsole } from './agent-console';
import { RedTeamConsole } from './redteam-console';
import { CommandPalette } from './command-palette';
import { Titlebar } from './titlebar';
import { WorkspacePanel, WORKSPACE_TABS } from './workspace/workspace-panel';
import type { WorkspaceTab } from './workspace/workspace-panel';
import { useTheme } from './use-theme';

type Pane = 'rail' | 'mid' | 'work';

export interface AppShellProps {
  readonly workspace: WorkspaceView;
  /**
   * The replay list the server built this workspace from — already validated
   * on that side. The shell re-sends it with every action and writes it back
   * into the URL, but never invents an entry.
   */
  readonly overlay: readonly BranchSpec[];
  /**
   * Set when the URL carried entries that could not be restored. Reported by
   * category and count by the server; rendered verbatim here and never
   * composed from the offending input.
   */
  readonly overlayNote: string | null;
}

/**
 * Open on the most interesting line rather than the reference: the first
 * branch that carries an edit. Derived, not named. Also the fallback when the
 * selected line is no longer in the workspace.
 */
function preferredBranch(workspace: WorkspaceView): string {
  const edited = workspace.branches.find((b) => b.tipEdit !== null);
  return (edited ?? workspace.branches[0])?.name ?? workspace.defaultBranch;
}

export function AppShell({
  workspace: initial,
  overlay: initialOverlay,
  overlayNote,
}: AppShellProps) {
  // The workspace is server-rendered, then replaced optimistically when the
  // user creates a branch so the new line is on screen without waiting for a
  // round trip. `overlay` is the replay list the server needs to rebuild that
  // state on later calls — see `BranchSpec`.
  const [workspace, setWorkspace] = useState(initial);
  const [overlay, setOverlay] = useState<readonly BranchSpec[]>(initialOverlay);
  const [current, setCurrent] = useState(() => preferredBranch(initial));

  // Resync when the server sends a new snapshot.
  //
  // These three were seeded from props once and then never looked at the
  // props again, so a `router.refresh()` or a soft navigation back to `/`
  // carrying different data kept rendering the first snapshot. That was
  // latent until created lines moved into the URL; now the server's answer to
  // a `router.replace` *is* how a created line arrives, which makes it
  // load-bearing. Compared by identity and applied during render — the React
  // pattern for prop-derived state — rather than in an effect, so nothing
  // renders from the stale snapshot first.
  const [synced, setSynced] = useState(initial);
  if (initial !== synced) {
    setSynced(initial);
    setWorkspace(initial);
    setOverlay(initialOverlay);
    // The selected line may not exist in the new snapshot — a shared link
    // without it, or a replay that dropped it. Keep the selection when it
    // survives, fall back to a branch that exists when it does not, so the
    // rail never points at nothing.
    setCurrent((name) =>
      initial.branches.some((b) => b.name === name) ? name : preferredBranch(initial),
    );
  }
  const [tab, setTab] = useState<WorkspaceTab>('overview');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [midCollapsed, setMidCollapsed] = useState(false);
  const [pane, setPane] = useState<Pane>('work');
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** A run from the red-team console, shown in place of the branch's own. */
  const [consoleRun, setConsoleRun] = useState<ScreenView | null>(null);

  const { theme, toggle: toggleTheme } = useTheme();
  const router = useRouter();

  const branch =
    workspace.branches.find((b) => b.name === current) ?? workspace.branches[0];

  const selectBranch = useCallback((name: string) => {
    setCurrent(name);
    // A branch switch invalidates the ad-hoc console run: it was screened for
    // a different request and would be misleading beside the new branch.
    setConsoleRun(null);
  }, []);

  const commands = useMemo<readonly ShellCommand[]>(() => {
    if (branch === undefined) return [];
    const list: ShellCommand[] = [];

    for (const b of workspace.branches) {
      list.push({
        id: `branch:${b.name}`,
        group: 'Branch',
        label: `Switch to ${b.name}`,
        hint: `${b.shortHead} · ${b.run === null ? 'no run' : b.run.check.status}`,
        icon: 'GitBranch',
        keywords: [
          b.name,
          b.genotypeId ?? '',
          b.genotypeLabel ?? '',
          b.tipEdit?.label ?? '',
        ].filter((k) => k.length > 0),
        disabled: b.name === current,
        run: () => selectBranch(b.name),
      });
    }

    list.push({
      id: 'pipeline:open',
      group: 'Pipeline',
      label: 'Show the agent run for this branch',
      hint: branch.run === null ? 'no run' : `${branch.run.steps.length} agents`,
      icon: 'Play',
      keywords: ['ci', 'checks', 'pipeline', 'agents', 'run'],
      run: () => {
        setConsoleRun(null);
        setMidCollapsed(false);
        setPane('mid');
      },
    });

    list.push({
      id: 'pipeline:redteam',
      group: 'Pipeline',
      label: 'Focus the red-team console',
      hint: 'biosafety gate',
      icon: 'ShieldCheck',
      keywords: ['red team', 'safety', 'gate', 'screen', 'policy'],
      run: () => {
        setMidCollapsed(false);
        setPane('mid');
        // Focus after the pane has had a frame to appear.
        requestAnimationFrame(() => {
          const field = document.querySelector<HTMLTextAreaElement>(
            'textarea[name="request"]',
          );
          field?.focus();
        });
      },
    });

    if (branch.tipEdit !== null) {
      const edit = branch.tipEdit;
      list.push({
        id: 'workspace:editsite',
        group: 'Workspace',
        label: `Jump to the edit site — codon ${edit.codonIndex}`,
        hint: `${edit.refCodon} → ${edit.altCodon}`,
        icon: 'Crosshair',
        keywords: ['edit', 'codon', 'site', 'position', edit.label],
        run: () => {
          setTab('track');
          setPane('work');
        },
      });
    }

    for (const spec of WORKSPACE_TABS) {
      list.push({
        id: `workspace:${spec.id}`,
        group: 'Workspace',
        label: `Open ${spec.label}`,
        icon: TAB_ICONS[spec.id],
        keywords: [spec.label, spec.id],
        disabled: spec.id === tab,
        run: () => {
          setTab(spec.id);
          setPane('work');
        },
      });
    }

    for (const surface of SURFACES) {
      list.push({
        id: `surface:${surface.href}`,
        group: 'Workspace',
        label: `Go to ${surface.label}`,
        hint: surface.href,
        icon: surface.icon,
        keywords: ['variant', 'surface', surface.href.replace('/', ''), surface.concept],
        // The created lines ride along in the query string. A variant surface
        // need not render them — but it must not drop them, or coming back
        // here would land on a workspace missing the user's own work.
        run: () => router.push(withOverlay(surface.href, overlay)),
      });
    }

    list.push(
      {
        id: 'view:rail',
        group: 'View',
        label: railCollapsed ? 'Expand the branch rail' : 'Collapse the branch rail',
        icon: 'PanelLeft',
        keywords: ['sidebar', 'rail', 'branches', 'collapse'],
        run: () => setRailCollapsed((v) => !v),
      },
      {
        id: 'view:mid',
        group: 'View',
        label: midCollapsed ? 'Expand the agent panel' : 'Collapse the agent panel',
        icon: 'PanelRight',
        keywords: ['console', 'agents', 'collapse'],
        run: () => setMidCollapsed((v) => !v),
      },
      {
        id: 'view:theme',
        group: 'View',
        label: theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme',
        icon: 'SunMoon',
        keywords: ['theme', 'dark', 'light', 'appearance'],
        run: toggleTheme,
      },
    );

    return list;
  }, [
    branch,
    current,
    midCollapsed,
    overlay,
    railCollapsed,
    router,
    selectBranch,
    tab,
    theme,
    toggleTheme,
    workspace.branches,
  ]);

  if (branch === undefined) {
    // Only reachable if the fixture carried no loci, which `model/workspace.ts`
    // already refuses. Rendered rather than thrown so the shell degrades.
    return (
      <main className="flex h-dvh items-center justify-center p-8 text-center">
        <p className="work__sub">
          No locus could be loaded from <span className="seq normal-case">data/loci.json</span>.
        </p>
      </main>
    );
  }

  const run = consoleRun?.run ?? branch.run;

  return (
    <div
      className="shell"
      data-rail={railCollapsed ? 'collapsed' : 'open'}
      data-mid={midCollapsed ? 'collapsed' : 'open'}
    >
      <Titlebar
        locus={workspace.locus}
        branch={branch}
        railCollapsed={railCollapsed}
        midCollapsed={midCollapsed}
        onToggleRail={() => setRailCollapsed((v) => !v)}
        onToggleMid={() => setMidCollapsed((v) => !v)}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <nav
        className="rail vibrancy"
        data-pane="rail"
        data-visible={pane === 'rail'}
        aria-label="Branches"
      >
        <BranchRail
          locus={workspace.locus}
          branches={workspace.branches}
          variants={workspace.variants}
          current={branch.name}
          collapsed={railCollapsed}
          overlay={overlay}
          onSelect={selectBranch}
          onCreated={(next, nextOverlay, created) => {
            setWorkspace(next);
            setOverlay(nextOverlay);
            // Put the line in the URL so it survives leaving this surface and
            // coming back, and a reload. `replace`, not `push`: the created
            // line is not a place in the history, and pushing would make the
            // back button walk one entry per created line.
            router.replace(withOverlay('/', nextOverlay), { scroll: false });
            // Switch to what was just created: the point of creating a line is
            // to look at its diff.
            selectBranch(created);
            setTab('diff');
            setPane('work');
          }}
        />
      </nav>

      <section
        className="mid"
        data-pane="mid"
        data-visible={pane === 'mid'}
        aria-label="Agent run and red-team console"
      >
        <div className="mid__head">
          <h2 className="mid__title">
            {consoleRun === null ? 'Agent run' : 'Console run'}
          </h2>
          {consoleRun === null ? null : (
            <button
              type="button"
              className="chrome-btn"
              onClick={() => setConsoleRun(null)}
            >
              Back to branch
            </button>
          )}
          <span className="mid__spine" aria-hidden="true">
            Agent run
          </span>
        </div>

        <div className="mid__body">
          {run === null ? (
            <div className="run">
              <p className="run__request m-2">
                <span className="run__request-label">No check run</span>
                <strong className="font-medium">{branch.name}</strong> holds the
                imported reference and introduces no edit, so there is nothing for the
                pipeline to screen. Switch to a genotype line, or type a request below
                to run the agent checks against it.
              </p>
            </div>
          ) : (
            <AgentConsole
              run={run}
              caption={
                consoleRun === null
                  ? 'Request screened by the gate'
                  : 'Request typed in the console'
              }
            />
          )}
          <RedTeamConsole example={workspace.exampleRequest} onRun={setConsoleRun} />
        </div>
      </section>

      <main className="work" data-pane="work" data-visible={pane === 'work'}>
        {overlayNote === null ? null : (
          // The workspace pane is the one that is visible at every width, so
          // a link that could not be fully restored says so where it will
          // actually be read. The text names counts and categories only — the
          // offending name or edit id is never echoed back into the page.
          <p
            className="work__sub shrink-0 border-b px-4 py-2"
            role="status"
            data-testid="overlay-note"
          >
            {overlayNote}
          </p>
        )}
        <WorkspacePanel
          locus={workspace.locus}
          branches={workspace.branches}
          branch={branch}
          overlay={overlay}
          defaultBranch={workspace.defaultBranch}
          simulation={workspace.simulation}
          fixtureDisclaimer={workspace.fixtureDisclaimer}
          tab={tab}
          onTabChange={setTab}
        />
      </main>

      {/* Narrow windows only (CSS-gated): one pane at a time with a switcher. */}
      <nav className="switcher" aria-label="Switch pane">
        <button
          type="button"
          className="switcher__btn"
          aria-current={pane === 'rail'}
          onClick={() => setPane('rail')}
        >
          <GitBranch className="switcher__icon" strokeWidth={1.75} aria-hidden="true" />
          Branches
        </button>
        <button
          type="button"
          className="switcher__btn"
          aria-current={pane === 'mid'}
          onClick={() => setPane('mid')}
        >
          <Terminal className="switcher__icon" strokeWidth={1.75} aria-hidden="true" />
          Agents
        </button>
        <button
          type="button"
          className="switcher__btn"
          aria-current={pane === 'work'}
          onClick={() => setPane('work')}
        >
          <Columns3 className="switcher__icon" strokeWidth={1.75} aria-hidden="true" />
          Workspace
        </button>
      </nav>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={commands}
      />
    </div>
  );
}

/** Tab → palette icon. A closed map, so a new tab cannot ship iconless. */
const TAB_ICONS: Readonly<Record<WorkspaceTab, ShellCommand['icon']>> = Object.freeze({
  overview: 'Activity',
  diff: 'Columns3',
  track: 'Dna',
  protein: 'Atom',
  cell: 'Activity',
  genome3d: 'Dna',
  upload: 'Upload',
  merge: 'GitMerge',
});
