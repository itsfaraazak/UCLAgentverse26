"use client";

import * as React from "react";
import {
  Activity,
  Atom,
  Columns3,
  Crosshair,
  Dna,
  GitBranch,
  GitMerge,
  PanelLeft,
  PanelRight,
  Play,
  ShieldCheck,
  SunMoon,
  Upload,
  type LucideIcon,
} from "lucide-react";

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
} from "@/components/ui/command";
import type {
  CommandGroup as CommandGroupName,
  CommandIconName,
  ShellCommand,
} from "@/components/shell/model/commands";

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly commands: readonly ShellCommand[];
}

const ICONS: Record<CommandIconName, LucideIcon> = {
  GitBranch,
  GitMerge,
  Play,
  ShieldCheck,
  Columns3,
  Dna,
  Atom,
  Activity,
  PanelLeft,
  PanelRight,
  Crosshair,
  SunMoon,
  Upload,
};

const GROUP_ORDER: readonly CommandGroupName[] = [
  "Branch",
  "Pipeline",
  "Workspace",
  "View",
];

function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isInsideContentEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.isContentEditable;
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: CommandPaletteProps): React.ReactElement {
  React.useEffect(() => {
    const apple = isApplePlatform();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== "k" || event.altKey) return;
      const chord = apple
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (!chord || isInsideContentEditable(event.target)) return;

      event.preventDefault();
      if (event.repeat) return;
      onOpenChange(!open);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const groups = React.useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        items: commands.filter((command) => command.group === group),
      })).filter(({ items }) => items.length > 0),
    [commands],
  );

  function select(command: ShellCommand): void {
    command.run();
    onOpenChange(false);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search for a branch, pipeline, workspace or view command."
      className="ring-foreground/[0.08] shadow-none sm:max-w-xl"
    >
      <Command className="rounded-none! p-1">
        <CommandInput placeholder="Type a command or search…" />
        <CommandSeparator className="mt-1" />
        <CommandList className="max-h-[min(24rem,60vh)] py-1">
          <CommandEmpty className="py-8 text-sm text-muted-foreground">
            No matching command.
          </CommandEmpty>
          {groups.map(({ group, items }) => (
            <CommandGroup
              key={group}
              heading={
                <span className="font-display text-[0.6875rem] tracking-[0.06em]! text-muted-foreground uppercase">
                  {group}
                </span>
              }
              className="px-1 py-0.5 **:[[cmdk-group-heading]]:pt-2.5 **:[[cmdk-group-heading]]:pb-1"
            >
              {items.map((command) => (
                <CommandPaletteRow
                  key={command.id}
                  command={command}
                  onSelect={select}
                />
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function CommandPaletteRow({
  command,
  onSelect,
}: {
  readonly command: ShellCommand;
  readonly onSelect: (command: ShellCommand) => void;
}): React.ReactElement {
  const Icon = ICONS[command.icon];
  const hasTrailing =
    command.hint !== undefined ||
    (command.shortcut !== undefined && command.shortcut.length > 0);

  return (
    <CommandItem
      // Keyed by id, not label: cmdk treats `value` as the row identity, so
      // two commands with the same label would collapse into one selectable
      // row. The label moves into `keywords` so it is still searched.
      value={command.id}
      keywords={[command.label, ...(command.keywords ?? [])]}
      disabled={command.disabled}
      onSelect={() => onSelect(command)}
      className="h-9 gap-2.5 py-0 text-sm text-foreground data-selected:bg-accent data-selected:text-accent-foreground [&_svg]:text-muted-foreground"
    >
      <Icon aria-hidden className="h-4 w-4" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">{command.label}</span>
      {hasTrailing ? (
        <CommandShortcut className="flex shrink-0 items-center gap-2 tracking-normal">
          {command.hint !== undefined ? (
            <span className="max-w-48 truncate text-xs text-muted-foreground">
              {command.hint}
            </span>
          ) : null}
          {command.shortcut !== undefined && command.shortcut.length > 0 ? (
            <span className="flex items-center gap-0.5">
              {command.shortcut.map((key, index) => (
                <kbd
                  key={`${key}-${index}`}
                  className="hairline inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1 font-sans text-[0.6875rem] leading-none text-muted-foreground"
                >
                  {key}
                </kbd>
              ))}
            </span>
          ) : null}
        </CommandShortcut>
      ) : null}
    </CommandItem>
  );
}
