'use client';

/**
 * macOS window chrome, in the browser and without Electron: traffic lights,
 * a centred proxy-icon title, and the editor's own controls on the right.
 *
 * The traffic lights are decorative — there is no window to close — so they
 * are marked `aria-hidden` rather than exposed as three unlabelled buttons.
 */

import {
  GitBranch,
  GitPullRequest,
  Moon,
  PanelBottom,
  Search,
  Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/shell/use-theme';

export interface TitlebarProps {
  readonly gene: string;
  readonly geneName: string;
  readonly branch: string;
  readonly baseBranch: string | null;
  readonly headShort: string;
  readonly panelOpen: boolean;
  readonly onTogglePanel: () => void;
  readonly onOpenPalette: () => void;
}

function ThemeToggle() {
  const { dark, toggle } = useTheme();

  return (
    <Button
      size="icon-xs"
      variant="ghost"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}

export function Titlebar({
  gene,
  geneName,
  branch,
  baseBranch,
  headShort,
  panelOpen,
  onTogglePanel,
  onOpenPalette,
}: TitlebarProps) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-chrome-border bg-chrome px-2.5">
      {/* Traffic lights. */}
      <div className="flex shrink-0 items-center gap-[7px] pr-1" aria-hidden>
        <span className="size-[11px] rounded-full bg-[#ec6a5e] ring-1 ring-black/10 ring-inset" />
        <span className="size-[11px] rounded-full bg-[#f4bf4f] ring-1 ring-black/10 ring-inset" />
        <span className="size-[11px] rounded-full bg-[#61c454] ring-1 ring-black/10 ring-inset" />
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <h1 className="truncate text-[12.5px] font-semibold">
          SigmaFold
          <span className="font-normal text-muted-foreground"> — {gene} review</span>
        </h1>
        <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">
          {geneName}
        </span>
      </div>

      {/* Branch / head, the way a status bar states a checkout. */}
      <div className="mx-auto hidden min-w-0 items-center gap-1.5 rounded-md border border-chrome-border bg-card/70 px-2 py-0.5 md:flex">
        <GitBranch className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-mono text-[11px]">{branch}</span>
        {baseBranch !== null && (
          <>
            <span className="text-[10px] text-muted-foreground">into</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {baseBranch}
            </span>
          </>
        )}
        <span className="nums font-mono text-[10px] text-muted-foreground">{headShort}</span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          size="xs"
          variant="outline"
          onClick={onOpenPalette}
          className="gap-1.5"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <Search aria-hidden />
          <span className="hidden sm:inline">Commands</span>
          <kbd className="ml-0.5 rounded-sm border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onTogglePanel}
          aria-pressed={panelOpen}
          aria-label={panelOpen ? 'Hide bottom panel' : 'Show bottom panel'}
        >
          <PanelBottom aria-hidden />
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
