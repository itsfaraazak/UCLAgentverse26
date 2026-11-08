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
 */

import { useCallback, useMemo, useState } from 'react';
import { Columns3, GitBranch, Terminal } from 'lucide-react';

import './shell.css';

import type { ScreenView, WorkspaceView } from './model/types';
import type { ShellCommand } from './model/commands';
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
}

export function AppShell({ workspace }: AppShellProps) {
  const [current, setCurrent] = useState(() => {
    // Open on the most interesting line rather than the reference: the first
    // branch that carries an edit. Derived, not named.
    const edited = workspace.branches.find((b) => b.tipEdit !== null);
    return (edited ?? workspace.branches[0])?.name ?? workspace.defaultBranch;
  });
  const [tab, setTab] = useState<WorkspaceTab>('overview');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [midCollapsed, setMidCollapsed] = useState(false);
  const [pane, setPane] = useState<Pane>('work');
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** A run from the red-team console, shown in place of the branch's own. */
  const [consoleRun, setConsoleRun] = useState<ScreenView | null>(null);

  const { theme, toggle: toggleTheme } = useTheme();

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
        hint: `${b.shortHead} · ${b.run.check.status}`,
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
      hint: `${branch.run.steps.length} agents`,
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
    railCollapsed,
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
          current={branch.name}
          collapsed={railCollapsed}
          onSelect={selectBranch}
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
          <AgentConsole
            run={run}
            caption={
              consoleRun === null
                ? 'Request screened by the gate'
                : 'Request typed in the console'
            }
          />
          <RedTeamConsole onRun={setConsoleRun} />
        </div>
      </section>

      <main className="work" data-pane="work" data-visible={pane === 'work'}>
        <WorkspacePanel
          locus={workspace.locus}
          branches={workspace.branches}
          branch={branch}
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
