'use client';

/**
 * The window chrome.
 *
 * macOS traffic lights, the wordmark in the display face, a breadcrumb naming
 * what is under review, and the controls that collapse the two side columns.
 * Translucent (`.vibrancy`) so the app reads as a native window rather than a
 * web page with a header (SPEC §5).
 */

import { Command, Moon, PanelLeft, PanelRight, Sun } from 'lucide-react';

import type { BranchView, LocusView } from './model/types';
import { VariantSwitcher } from './variant-switcher';
import { StatusPill, toneForRun } from './status';
import type { ThemeMode } from './use-theme';

export interface TitlebarProps {
  readonly locus: LocusView;
  readonly branch: BranchView;
  readonly railCollapsed: boolean;
  readonly midCollapsed: boolean;
  readonly onToggleRail: () => void;
  readonly onToggleMid: () => void;
  readonly theme: ThemeMode;
  readonly onToggleTheme: () => void;
  readonly onOpenPalette: () => void;
}

export function Titlebar({
  locus,
  branch,
  railCollapsed,
  midCollapsed,
  onToggleRail,
  onToggleMid,
  theme,
  onToggleTheme,
  onOpenPalette,
}: TitlebarProps) {
  const tone = toneForRun(branch.run);

  return (
    <header className="tb vibrancy shell__titlebar">
      {/* Decorative window furniture: this is a browser page, so the lights
          are not wired to window controls and are hidden from the a11y tree
          rather than announced as unusable buttons. */}
      <div className="tb__lights" aria-hidden="true">
        <span className="tb__light tb__light--close" />
        <span className="tb__light tb__light--min" />
        <span className="tb__light tb__light--max" />
      </div>

      <div className="tb__wordmark">
        <span className="font-display text-[0.9375rem] leading-none">SigmaFold</span>
        <span className="text-[0.625rem] uppercase tracking-[0.1em] text-muted-foreground">
          {locus.gene}
        </span>
      </div>

      <nav className="tb__crumbs" aria-label="Breadcrumb">
        <span className="tb__sep" aria-hidden="true">
          /
        </span>
        <span className="tb__crumb" title={`${locus.name}, chromosome ${locus.chromosome}`}>
          {locus.name}
        </span>
        <span className="tb__sep" aria-hidden="true">
          /
        </span>
        <span className="tb__crumb tb__crumb--strong">{branch.name}</span>
        <span className="seq tb__crumb text-[0.75rem] text-muted-foreground">
          {branch.shortHead}
        </span>
      </nav>

      <div className="tb__spacer" />

      <VariantSwitcher current="/" />

      <StatusPill tone={tone} />

      <div className="tb__actions">
        <button
          type="button"
          className="chrome-btn"
          onClick={onOpenPalette}
          aria-label="Open the command palette"
        >
          <Command className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          <span className="chrome-btn__kbd" aria-hidden="true">
            K
          </span>
        </button>

        <div className="tb__pane-toggles flex items-center gap-1">
          <button
            type="button"
            className="chrome-btn"
            onClick={onToggleRail}
            aria-pressed={!railCollapsed}
            aria-label={railCollapsed ? 'Expand the branch rail' : 'Collapse the branch rail'}
          >
            <PanelLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="chrome-btn"
            onClick={onToggleMid}
            aria-pressed={!midCollapsed}
            aria-label={midCollapsed ? 'Expand the agent run panel' : 'Collapse the agent run panel'}
          >
            <PanelRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          className="chrome-btn"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  );
}
