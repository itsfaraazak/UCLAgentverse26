'use client';

/**
 * macOS-feel window chrome: traffic lights, a translucent vibrancy bar, the
 * instrument's identity, and the controls that belong on the chrome — branch,
 * transport and panel lighting.
 */

import { GitBranch, Moon, Pause, Play, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { VariantSwitcher } from '@/components/shell/variant-switcher';

export interface TitleBarProps {
  branches: readonly string[];
  branch: string;
  onBranchChange: (branch: string) => void;
  running: boolean;
  onRunningChange: (running: boolean) => void;
  subtitle: string;
}

const STORAGE_KEY = 'sigmafold-theme';

export function TitleBar({
  branches,
  branch,
  onBranchChange,
  running,
  onRunningChange,
  subtitle,
}: TitleBarProps) {
  /**
   * The theme lives on `documentElement`, which is the source of truth the
   * pre-paint script in the layout also writes. Keeping it out of React state
   * avoids a hydration mismatch, so the two icons are swapped by CSS instead.
   */
  const toggleTheme = () => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      // Storage can be unavailable; the class change is what matters.
    }
  };

  return (
    <header className="vibrancy-surface sticky top-0 z-30 border-b border-border">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div aria-hidden="true" className="flex shrink-0 items-center gap-2">
          <span className="size-3 rounded-full bg-[#ff5f57] ring-1 ring-black/15 ring-inset" />
          <span className="size-3 rounded-full bg-[#febc2e] ring-1 ring-black/15 ring-inset" />
          <span className="size-3 rounded-full bg-[#28c840] ring-1 ring-black/15 ring-inset" />
        </div>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-tight">
            <span className="font-display">SigmaFold</span>{' '}
            <span className="text-muted-foreground">— Bench</span>
          </h1>
          <p className="truncate text-[0.6875rem] text-muted-foreground">{subtitle}</p>
        </div>

        <VariantSwitcher current="/bench" />

        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="branch-select" className="sr-only">
            Branch
          </label>
          <Select
            value={branch}
            onValueChange={(next) => {
              if (typeof next === 'string') onBranchChange(next);
            }}
          >
            <SelectTrigger id="branch-select" size="sm" className="w-[13.5rem]">
              <GitBranch className="size-3.5" aria-hidden="true" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b} value={b} className="font-mono text-xs">
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-pressed={running}
            aria-label={running ? 'Pause the simulation' : 'Resume the simulation'}
            onClick={() => onRunningChange(!running)}
          >
            {running ? (
              <Pause className="size-3.5" aria-hidden="true" />
            ) : (
              <Play className="size-3.5" aria-hidden="true" />
            )}
          </Button>

          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label="Toggle panel lighting between dark and light"
            onClick={toggleTheme}
          >
            <Sun className="hidden size-3.5 dark:block" aria-hidden="true" />
            <Moon className="size-3.5 dark:hidden" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </header>
  );
}
