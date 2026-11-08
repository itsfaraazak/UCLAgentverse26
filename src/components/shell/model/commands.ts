/**
 * The ⌘K command contract.
 *
 * The shell owns every action; the palette only renders and invokes. Keeping
 * the command list as data means the same entries can be surfaced elsewhere
 * (a menu, a shortcut hint) without duplicating behaviour.
 */

export type CommandGroup = 'Branch' | 'Pipeline' | 'Workspace' | 'View';

export interface ShellCommand {
  readonly id: string;
  readonly group: CommandGroup;
  readonly label: string;
  /** Secondary text: a commit short-oid, a check state, a pane name. */
  readonly hint?: string;
  /** lucide-react icon name, e.g. `GitBranch`. Resolved by the palette. */
  readonly icon: CommandIconName;
  /** Extra words to match on beyond the label. */
  readonly keywords?: readonly string[];
  /** Rendered as a ⌘-style chord on the right of the row. */
  readonly shortcut?: readonly string[];
  readonly disabled?: boolean;
  readonly run: () => void;
}

/**
 * The closed set of icons the palette may render. A union rather than a free
 * string so a typo is a compile error instead of a blank row.
 */
export type CommandIconName =
  | 'GitBranch'
  | 'GitMerge'
  | 'Play'
  | 'ShieldCheck'
  | 'Columns3'
  | 'Dna'
  | 'Atom'
  | 'Activity'
  | 'PanelLeft'
  | 'PanelRight'
  | 'Crosshair'
  | 'SunMoon'
  | 'Upload';
