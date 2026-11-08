"use client";

import * as React from "react";
import { cn } from "cn";
import {
  ArrowLeftRight,
  ArrowRight,
  Crosshair,
  Equal,
  Info,
  Minus,
  Plus,
  type LucideIcon,
} from "lucide-react";

import type { DiffRow } from "@/lib/genome";
import type { DiffView } from "@/components/shell/model/types";

export interface DiffRegistersProps {
  readonly diff: DiffView;
  /** Alignment row to scroll into view and mark as the edit site. */
  readonly focusRow?: number | null;
  readonly className?: string;
}

type ChangeKind =
  | "same"
  | "missense"
  | "nonsense"
  | "stop-loss"
  | "substitution"
  | "silent"
  | "insertion"
  | "deletion";

type Tone = "quiet" | "strong" | "silent" | "indel";

interface KindMeta {
  readonly label: string;
  readonly tone: Tone;
  readonly icon: LucideIcon | null;
}

const KIND_META: Readonly<Record<ChangeKind, KindMeta>> = {
  same: { label: "unchanged", tone: "quiet", icon: null },
  missense: { label: "missense", tone: "strong", icon: ArrowLeftRight },
  nonsense: { label: "nonsense", tone: "strong", icon: ArrowLeftRight },
  "stop-loss": { label: "stop-loss", tone: "strong", icon: ArrowLeftRight },
  substitution: { label: "substitution", tone: "strong", icon: ArrowLeftRight },
  silent: { label: "silent", tone: "silent", icon: Equal },
  insertion: { label: "insertion", tone: "indel", icon: Plus },
  deletion: { label: "deletion", tone: "indel", icon: Minus },
};

/*
 * Tones deliberately avoid the verdict triple.
 *
 * `--verdict-pass/escalate/block` mean "a check passed / escalated / was
 * refused". A diff row is not a verdict: the sickle substitution and the
 * repair that undoes it are both missense rows, and painting either of them
 * block-red would assert a judgement the diff has not made — the gate makes
 * that call, and it is reported in the run log and the merge view.
 *
 * So the single accent marks *where the edit is*, and the distinction between
 * a missense change, a silent one and an indel is carried by prominence, by a
 * distinct lucide icon, and by a word. Silent rows recede rather than taking
 * the accent, because a codon change with no protein change genuinely matters
 * less — which is a difference in emphasis, not a difference in hue.
 */
const ROW_TONE: Readonly<Record<Tone, string>> = {
  quiet: "text-muted-foreground",
  strong: "bg-primary/8 text-foreground",
  silent: "text-foreground",
  indel: "bg-primary/8 text-foreground",
};

const CHIP_TONE: Readonly<Record<Tone, string>> = {
  quiet: "",
  strong: "bg-primary/15",
  silent: "bg-foreground/8",
  indel: "bg-primary/15",
};

const ICON_TONE: Readonly<Record<Tone, string>> = {
  quiet: "",
  strong: "text-primary",
  silent: "text-muted-foreground",
  indel: "text-primary",
};

const BASE_MARK_TONE: Readonly<Record<Tone, string>> = {
  quiet: "",
  strong: "bg-primary/25",
  silent: "bg-foreground/12",
  indel: "",
};

function classify(row: DiffRow): ChangeKind {
  switch (row.status) {
    case "same":
      return "same";
    case "added":
      return "insertion";
    case "removed":
      return "deletion";
    case "changed":
      if (row.silent) return "silent";
      if (row.refAa === null || row.altAa === null) return "substitution";
      if (row.altAa === "*") return "nonsense";
      if (row.refAa === "*") return "stop-loss";
      return "missense";
  }
}

function spokenResidue(aa: string): string {
  return aa === "*" ? "stop" : aa;
}

/** 1-based positions within the codon (1–3) at which the two triplets differ. */
function differingPositions(a: string, b: string): number[] {
  const positions: number[] = [];
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a.charAt(i) !== b.charAt(i)) positions.push(i + 1);
  }
  return positions;
}

function Gap({ spoken }: { readonly spoken: string }) {
  return (
    <>
      <span aria-hidden="true" className="seq text-muted-foreground">
        {"———"}
      </span>
      <span className="sr-only">{spoken}</span>
    </>
  );
}

function DnaLine({
  side,
  codon,
  other,
  markDiffs,
  tone,
}: {
  readonly side: "Reference" | "Alternate";
  readonly codon: string | null;
  readonly other: string | null;
  readonly markDiffs: boolean;
  readonly tone: Tone;
}) {
  if (codon === null) {
    return (
      <span className="block leading-5">
        <span className="sr-only">{side}: </span>
        <Gap spoken="no codon (gap)" />
      </span>
    );
  }

  const diffs = markDiffs && other !== null ? differingPositions(codon, other) : [];

  return (
    <span className="block leading-5">
      <span className="sr-only">{side}: </span>
      <span className="seq">
        {Array.from(codon).map((base, i) =>
          diffs.includes(i + 1) ? (
            <mark
              key={i}
              className={cn(
                "rounded-[2px] px-px font-semibold text-foreground underline decoration-2 underline-offset-2",
                BASE_MARK_TONE[tone],
              )}
            >
              {base}
            </mark>
          ) : (
            <span key={i}>{base}</span>
          ),
        )}
      </span>
      {diffs.length > 0 ? (
        <span className="sr-only">
          {`, differs at codon position ${diffs.join(" and ")}`}
        </span>
      ) : null}
    </span>
  );
}

function Residue({
  value,
  spoken,
}: {
  readonly value: string | null;
  readonly spoken: (value: string) => string;
}) {
  if (value === null) return <Gap spoken="gap" />;
  const said = spoken(value);
  if (said === value) return <span className="seq">{value}</span>;
  return (
    <>
      <span aria-hidden="true" className="seq">
        {value}
      </span>
      <span className="sr-only">{said}</span>
    </>
  );
}

function Pair({
  refValue,
  altValue,
  spoken,
}: {
  readonly refValue: string | null;
  readonly altValue: string | null;
  readonly spoken: (value: string) => string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Residue value={refValue} spoken={spoken} />
      <ArrowRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
      <span className="sr-only">to</span>
      <Residue value={altValue} spoken={spoken} />
    </span>
  );
}

function ChangeChip({ kind }: { readonly kind: ChangeKind }) {
  const meta = KIND_META[kind];
  if (meta.icon === null) {
    return <span className="sr-only">{meta.label}</span>;
  }
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[0.6875rem] font-medium leading-none text-foreground",
        CHIP_TONE[meta.tone],
      )}
    >
      <Icon aria-hidden="true" className={cn("size-3 shrink-0", ICON_TONE[meta.tone])} />
      {meta.label}
    </span>
  );
}

function rowSummary(row: DiffRow, kind: ChangeKind): string | null {
  if (kind === "same") return null;
  const label = KIND_META[kind].label;
  if (kind === "insertion" && row.altCodon !== null) {
    return `${label}: ${row.altCodon} added in alternate`;
  }
  if (kind === "deletion" && row.refCodon !== null) {
    return `${label}: ${row.refCodon} absent from alternate`;
  }
  if (row.refCodon !== null && row.altCodon !== null) {
    const codons = `${row.refCodon} to ${row.altCodon}`;
    const residues =
      row.refAa !== null && row.altAa !== null
        ? `, ${spokenResidue(row.refAa)} to ${spokenResidue(row.altAa)}`
        : "";
    return `${label} change: ${codons}${residues}`;
  }
  return label;
}

const CHANGE_KINDS: readonly Exclude<ChangeKind, "same">[] = [
  "missense",
  "nonsense",
  "stop-loss",
  "substitution",
  "silent",
  "insertion",
  "deletion",
];

const COLUMNS: readonly { readonly name: string; readonly hint: string | null }[] = [
  { name: "Row", hint: "alignment" },
  { name: "DNA", hint: "ref / alt" },
  { name: "Codon", hint: "ref → alt" },
  { name: "Amino acid", hint: "ref → alt" },
  { name: "Change", hint: null },
];

const CELL = "border-b-[0.5px] border-border px-3 py-1.5 align-middle";

export function DiffRegisters({
  diff,
  focusRow = null,
  className,
}: DiffRegistersProps): React.ReactElement {
  const headingId = React.useId();
  const noteId = React.useId();
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const counts = React.useMemo(() => {
    const tally: Record<ChangeKind, number> = {
      same: 0,
      missense: 0,
      nonsense: 0,
      "stop-loss": 0,
      substitution: 0,
      silent: 0,
      insertion: 0,
      deletion: 0,
    };
    for (const row of diff.rows) tally[classify(row)] += 1;
    return tally;
  }, [diff.rows]);

  React.useEffect(() => {
    if (focusRow === null) return;
    const container = scrollRef.current;
    if (container === null) return;
    const target = container.querySelector(`[data-row="${focusRow}"]`);
    if (!(target instanceof HTMLElement)) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top =
      targetRect.top -
      containerRect.top +
      container.scrollTop -
      (container.clientHeight - targetRect.height) / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
  }, [focusRow]);

  const changedCount = diff.changedRows.length;
  const breakdown = CHANGE_KINDS.filter((kind) => counts[kind] > 0);

  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-h-0 flex-col text-[0.8125rem]", className)}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-[0.5px] border-border px-3 pb-2.5 pt-1">
        <div className="min-w-0 space-y-1">
          <h2 id={headingId} className="font-display text-sm text-foreground">
            Sequence diff
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
            <dt className="text-muted-foreground">Reference</dt>
            <dd className="truncate text-foreground">{diff.ref.label}</dd>
            <dt className="text-muted-foreground">Alternate</dt>
            <dd className="truncate text-foreground">{diff.alt.label}</dd>
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-foreground">
            {changedCount === 0
              ? "No changed rows"
              : `${changedCount} changed ${changedCount === 1 ? "row" : "rows"}`}
            <span className="text-muted-foreground">{` of ${diff.rows.length}`}</span>
          </span>
          {breakdown.map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1">
              <ChangeChip kind={kind} />
              <span className="tabular-nums text-muted-foreground">{counts[kind]}</span>
            </span>
          ))}
        </div>
      </header>

      <div
        ref={scrollRef}
        role="region"
        aria-labelledby={headingId}
        tabIndex={0}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        <table
          aria-describedby={noteId}
          className="w-full min-w-[36rem] table-fixed border-separate border-spacing-0"
        >
          <caption className="sr-only">
            {`${diff.ref.label} against ${diff.alt.label}, one alignment row per line, in three registers: DNA, codon and amino acid. Reference is listed before alternate.`}
          </caption>
          <colgroup>
            <col className="w-16" />
            <col className="w-28" />
            <col className="w-40" />
            <col className="w-28" />
            <col />
          </colgroup>
          <thead>
            <tr className="text-left text-[0.6875rem] font-medium text-muted-foreground">
              {COLUMNS.map(({ name, hint }, i) => (
                <th
                  key={name}
                  scope="col"
                  className={cn(
                    "sticky top-0 z-10 border-b-[0.5px] border-border bg-background px-3 py-2 font-medium",
                    i === 0 && "border-l border-l-transparent",
                  )}
                >
                  <span className="text-foreground">{name}</span>
                  {hint !== null ? (
                    <span className="ml-1.5 font-normal text-muted-foreground">{hint}</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {diff.rows.map((row) => {
              const kind = classify(row);
              const tone = KIND_META[kind].tone;
              const isFocus = focusRow !== null && row.codonIndex === focusRow;
              const summary = rowSummary(row, kind);
              return (
                <tr key={row.codonIndex} data-row={row.codonIndex} className={ROW_TONE[tone]}>
                  <th
                    scope="row"
                    className={cn(
                      CELL,
                      "border-l text-left font-normal tabular-nums",
                      isFocus ? "border-l-primary text-foreground" : "border-l-transparent",
                    )}
                  >
                    {row.codonIndex}
                  </th>
                  <td className={CELL}>
                    <DnaLine
                      side="Reference"
                      codon={row.refCodon}
                      other={row.altCodon}
                      markDiffs={row.status === "changed"}
                      tone={tone}
                    />
                    <DnaLine
                      side="Alternate"
                      codon={row.altCodon}
                      other={row.refCodon}
                      markDiffs={row.status === "changed"}
                      tone={tone}
                    />
                  </td>
                  <td className={CELL}>
                    <Pair refValue={row.refCodon} altValue={row.altCodon} spoken={(v) => v} />
                  </td>
                  <td className={CELL}>
                    <Pair refValue={row.refAa} altValue={row.altAa} spoken={spokenResidue} />
                  </td>
                  <td className={CELL}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <ChangeChip kind={kind} />
                      {isFocus ? (
                        <span className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-primary">
                          <Crosshair aria-hidden="true" className="size-3 shrink-0" />
                          Edit site
                        </span>
                      ) : null}
                      {summary !== null ? <span className="sr-only">{summary}</span> : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p
        id={noteId}
        className="flex items-start gap-1.5 border-t-[0.5px] border-border px-3 pb-1 pt-2 text-[0.6875rem] leading-4 text-muted-foreground"
      >
        <Info aria-hidden="true" className="mt-px size-3 shrink-0" />
        <span>{diff.coordinateNote}</span>
      </p>
    </section>
  );
}
