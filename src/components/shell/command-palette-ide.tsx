'use client';

/**
 * ⌘K command palette — the keyboard-first spine of this variant.
 *
 * Everything the triptych can do is reachable here: switch branch, run the
 * pipeline, jump to the edited codon, change the gene-track zoom, open the
 * red-team console or the cell canvas, attempt the merge, flip the theme.
 */

import {
  Command as CommandIcon,
  CornerDownLeft,
  FlaskConical,
  GitBranch,
  GitMerge,
  Microscope,
  MoonStar,
  PlayCircle,
  ScanSearch,
  Swords,
  Target,
  type LucideIcon,
} from 'lucide-react';

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import type { BranchView } from '@/lib/workspace';

export interface PaletteAction {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly shortcut?: string;
  readonly run: () => void;
  readonly hint?: string;
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly branches: readonly BranchView[];
  readonly activeBranch: string;
  readonly markerCodon: number | null;
  readonly onSelectBranch: (branch: string) => void;
  readonly onRunPipeline: () => void;
  readonly onJumpToEdit: () => void;
  readonly onAttemptMerge: () => void;
  readonly onOpenRedTeam: () => void;
  readonly onOpenCanvas: () => void;
  readonly onZoom: (zoom: 'locus' | 'exon' | 'codon') => void;
  readonly onToggleTheme: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  branches,
  activeBranch,
  markerCodon,
  onSelectBranch,
  onRunPipeline,
  onJumpToEdit,
  onAttemptMerge,
  onOpenRedTeam,
  onOpenCanvas,
  onZoom,
  onToggleTheme,
}: CommandPaletteProps) {
  const close = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="SigmaFold command palette"
      description="Switch branch, run the agent pipeline, jump to the edited codon, or open the red-team console."
      className="sm:max-w-xl"
    >
      <Command loop>
        <CommandInput placeholder="Type a command or a branch name…" />
        <CommandList className="max-h-[22rem]">
          <CommandEmpty>No matching command.</CommandEmpty>

          <CommandGroup heading="Pipeline">
            <CommandItem value="run checks pipeline agents" onSelect={close(onRunPipeline)}>
              <PlayCircle aria-hidden />
              Run the seven agent checks
              <CommandShortcut>⌘⏎</CommandShortcut>
            </CommandItem>
            <CommandItem value="attempt merge gate" onSelect={close(onAttemptMerge)}>
              <GitMerge aria-hidden />
              Attempt merge into the base branch
              <CommandShortcut>⌘⇧M</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Navigate">
            <CommandItem value="jump edited codon diff" onSelect={close(onJumpToEdit)}>
              <Target aria-hidden />
              {markerCodon === null
                ? 'Jump to the edit (this branch has none)'
                : `Jump to the edited codon (${markerCodon})`}
              <CommandShortcut>⌘G</CommandShortcut>
            </CommandItem>
            <CommandItem value="zoom locus gene track" onSelect={close(() => onZoom('locus'))}>
              <ScanSearch aria-hidden />
              Gene track — zoom to whole locus
            </CommandItem>
            <CommandItem value="zoom exon gene track" onSelect={close(() => onZoom('exon'))}>
              <ScanSearch aria-hidden />
              Gene track — zoom to the modelled exon
            </CommandItem>
            <CommandItem value="zoom codon gene track" onSelect={close(() => onZoom('codon'))}>
              <Microscope aria-hidden />
              Gene track — zoom to codon level
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Branches">
            {branches.map((branch) => (
              <CommandItem
                key={branch.name}
                value={`branch ${branch.name} ${branch.genotypeLabel}`}
                onSelect={close(() => onSelectBranch(branch.name))}
              >
                <GitBranch aria-hidden />
                <span className="font-mono">{branch.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {branch.genotypeLabel}
                </span>
                {branch.name === activeBranch && (
                  <CornerDownLeft className="ml-auto size-3 opacity-60" aria-label="current branch" />
                )}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Panel">
            <CommandItem value="red team console safety screen" onSelect={close(onOpenRedTeam)}>
              <Swords aria-hidden />
              Open the red-team console
              <CommandShortcut>⌘⇧R</CommandShortcut>
            </CommandItem>
            <CommandItem value="cell canvas simulation po2" onSelect={close(onOpenCanvas)}>
              <FlaskConical aria-hidden />
              Open the live cell canvas
              <CommandShortcut>⌘⇧C</CommandShortcut>
            </CommandItem>
            <CommandItem value="theme dark light appearance" onSelect={close(onToggleTheme)}>
              <MoonStar aria-hidden />
              Toggle light / dark appearance
            </CommandItem>
          </CommandGroup>
        </CommandList>

        <div className="flex items-center gap-2 border-t border-border px-2.5 py-1.5 text-[10px] text-muted-foreground">
          <CommandIcon className="size-3" aria-hidden />
          <span>
            Every command here is also a keyboard shortcut. The palette never bypasses the
            biosafety gate — running the pipeline from here screens the request first, exactly as
            the CI panel does.
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
}
