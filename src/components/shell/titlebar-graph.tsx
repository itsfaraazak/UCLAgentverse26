'use client';

import { useCallback } from 'react';
import { GitBranch, Moon, Sun, Dna } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { THEME_STORAGE_KEY } from './theme-script';
import { VariantSwitcher } from '@/components/shell/variant-switcher';

/** The three macOS window buttons. Decorative, and hidden from the AX tree. */
function TrafficLights() {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <span className="size-3 rounded-full bg-[#ff5f57] ring-1 ring-black/10 ring-inset" />
      <span className="size-3 rounded-full bg-[#febc2e] ring-1 ring-black/10 ring-inset" />
      <span className="size-3 rounded-full bg-[#28c840] ring-1 ring-black/10 ring-inset" />
    </div>
  );
}

/**
 * Theme toggle with no React state: the current theme lives on `<html>`, which
 * the pre-paint script already set. Both icons are rendered and CSS picks one,
 * so there is nothing to synchronise and no hydration mismatch to guard.
 */
function ThemeToggle() {
  const toggle = useCallback(() => {
    const root = document.documentElement;
    const next = !root.classList.contains('dark');
    root.classList.toggle('dark', next);
    root.dataset.theme = next ? 'dark' : 'light';
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      /* storage unavailable; the toggle still applies for this session */
    }
  }, []);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            aria-label="Toggle light or dark mode"
          >
            <Sun className="dark:hidden" />
            <Moon className="hidden dark:block" />
          </Button>
        }
      />
      <TooltipContent side="bottom">Toggle light or dark mode</TooltipContent>
    </Tooltip>
  );
}

export interface TitlebarProps {
  readonly repoName: string;
  readonly headBranch: string;
  readonly commitCount: number;
  readonly branchCount: number;
}

export function Titlebar({ repoName, headBranch, commitCount, branchCount }: TitlebarProps) {
  return (
    <header
      className="vibrancy sticky top-0 z-30 flex h-12 shrink-0 items-center gap-4 border-b px-4"
      // The whole bar reads as a window title bar.
      aria-label="Window title bar"
    >
      <TrafficLights />
      <Separator orientation="vertical" className="h-5" />
      <div className="flex min-w-0 items-center gap-2">
        <Dna className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <h1 className="truncate text-[13px] font-semibold tracking-tight">SigmaFold</h1>
        <span className="text-muted-foreground/60" aria-hidden="true">
          /
        </span>
        <span className="truncate font-mono text-[12px] text-muted-foreground">{repoName}</span>
      </div>
      <VariantSwitcher current="/graph" />

        <div className="ml-auto flex items-center gap-3">
        <span className="hidden items-center gap-1.5 text-[12px] text-muted-foreground tnum sm:flex">
          <GitBranch className="size-3.5" aria-hidden="true" />
          <span>
            {branchCount} branches · {commitCount} commits
          </span>
        </span>
        <Separator orientation="vertical" className="hidden h-5 sm:block" />
        <span className="flex items-center gap-1.5 rounded-md border bg-card/60 px-2 py-0.5 font-mono text-[11px]">
          <span className="sr-only">Checked out branch:</span>
          <GitBranch className="size-3 text-primary" aria-hidden="true" />
          {headBranch}
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
