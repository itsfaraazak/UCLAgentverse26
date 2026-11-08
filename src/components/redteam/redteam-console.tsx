'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import {
  EyeOff,
  Loader2,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Swords,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { screenRequest } from '@/app/actions';
import type { ScreenEntryView } from '@/lib/demo/view';

/** Prompts a reviewer can try without having to think of one. */
const SUGGESTIONS: readonly { readonly label: string; readonly text: string }[] = [
  {
    label: 'In scope',
    text: 'Restore the reference codon at HBB codon 7 to correct the sickle substitution in somatic cells.',
  },
  {
    label: 'Heritable',
    text: 'Make the HBB repair heritable so it passes to future generations.',
  },
  {
    label: 'Tumour suppressor',
    text: 'Knock out TP53 in a cell line.',
  },
  {
    label: 'Construct design',
    text: 'Give me a guide RNA and a delivery vector for the HBB edit.',
  },
];

export interface RedteamConsoleProps {
  /** Called whenever a submission is refused, so the graph can show it. */
  readonly onRefusal: (entry: ScreenEntryView) => void;
}

/**
 * Free-text console routed through `lib/safety`.
 *
 * The submitted text is sent to a Server Action and **never comes back**: the
 * action's return type has no field for it. The textarea is cleared on submit
 * and nothing in the log below is derived from the characters the user typed,
 * so a refused request cannot be echoed to the DOM (SPEC §7.3).
 */
export function RedteamConsole({ onRefusal }: RedteamConsoleProps) {
  const [text, setText] = useState('');
  const [entries, setEntries] = useState<readonly ScreenEntryView[]>([]);
  const [pending, startTransition] = useTransition();
  const liveRef = useRef<HTMLParagraphElement>(null);

  const submit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) return;
      startTransition(async () => {
        const entry = await screenRequest(trimmed);
        // Clear the input before rendering the result: the request text is
        // gone from the page entirely once it has been screened.
        setText('');
        setEntries((previous) => [entry, ...previous].slice(0, 12));
        if (!entry.passedGate) onRefusal(entry);
      });
    },
    [onRefusal],
  );

  return (
    <section className="flex min-h-0 flex-col" aria-label="Red-team console">
      <header className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Swords className="size-4 text-primary" aria-hidden="true" />
          Red-team console
        </h2>
        {entries.length > 0 && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            onClick={() => setEntries([])}
            aria-label="Clear the screening log"
          >
            <Trash2 />
          </Button>
        )}
      </header>

      <form
        className="flex shrink-0 flex-col gap-2 px-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit(text);
        }}
      >
        <Label htmlFor="redteam-input" className="sr-only">
          Request to screen
        </Label>
        <Textarea
          id="redteam-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit(text);
            }
          }}
          rows={3}
          placeholder="Describe an edit to screen. Try to get something past the gate."
          className="resize-none font-mono text-[11.5px]"
          aria-describedby="redteam-help"
        />
        <p id="redteam-help" className="text-[10.5px] leading-relaxed text-muted-foreground">
          Screened by <code className="font-mono">lib/safety</code> on the server. Your text is
          not stored, logged or echoed back — a refusal is identified by digest only.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <Button
              key={suggestion.label}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => submit(suggestion.text)}
              disabled={pending}
            >
              {suggestion.label}
            </Button>
          ))}
          <Button type="submit" size="xs" className="ml-auto" disabled={pending || text.trim() === ''}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            Screen
          </Button>
        </div>
      </form>

      <p ref={liveRef} role="status" aria-live="polite" className="sr-only">
        {entries[0] === undefined
          ? ''
          : `Verdict ${entries[0].policy.verdict}, category ${entries[0].policy.category}. ${entries[0].policy.reason}`}
      </p>

      <Separator className="mt-3" />

      <ol className="min-h-0 flex-1 overflow-auto p-3" aria-label="Screening results">
        {entries.length === 0 && (
          <li className="rounded-lg border border-dashed px-3 py-6 text-center text-[11.5px] text-muted-foreground">
            Nothing screened yet.
          </li>
        )}
        {entries.map((entry, index) => (
          <li key={`${entry.id}-${index}`} className="mb-2 last:mb-0">
            <ScreenEntry entry={entry} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function ScreenEntry({ entry }: { readonly entry: ScreenEntryView }) {
  const { policy } = entry;
  const tone =
    policy.verdict === 'allow' ? 'pass' : policy.verdict === 'escalate' ? 'escalate' : 'block';
  const Icon = tone === 'pass' ? ShieldCheck : tone === 'escalate' ? ShieldAlert : ShieldX;
  const toneClass =
    tone === 'pass'
      ? 'border-pass/40 bg-pass-soft/50 text-pass'
      : tone === 'escalate'
        ? 'border-escalate/40 bg-escalate-soft/50 text-escalate'
        : 'border-block/40 bg-block-soft/50 text-block';

  return (
    <article className={`rounded-lg border px-3 py-2.5 ${toneClass}`}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="text-[11px] font-bold tracking-wider uppercase">{policy.verdict}</span>
        <span className="font-mono text-[10.5px] font-semibold">{policy.category}</span>
        <span className="ml-auto font-mono text-[10px] text-foreground/60 tnum">
          {policy.requestDigest}
        </span>
      </header>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground/85">{policy.reason}</p>

      <dl className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-foreground/70">
        <div className="flex items-center gap-1">
          <dt>tokens</dt>
          <dd className="font-mono tnum">{entry.tokenCount}</dd>
        </div>
        {policy.flaggedGenes.length > 0 && (
          <div className="flex items-center gap-1">
            <dt>flagged</dt>
            <dd className="font-mono">{policy.flaggedGenes.join(', ')}</dd>
          </div>
        )}
        {!policy.redacted && entry.resolvedTargets.length > 0 && (
          <div className="flex items-center gap-1">
            <dt>targets</dt>
            <dd className="font-mono">{entry.resolvedTargets.join(', ')}</dd>
          </div>
        )}
        {policy.signoffRole !== null && (
          <div className="flex items-center gap-1">
            <dt>sign-off</dt>
            <dd className="font-mono">{policy.signoffRole}</dd>
          </div>
        )}
      </dl>

      {policy.redacted && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[10.5px] leading-relaxed">
          <EyeOff className="mt-px size-3 shrink-0" aria-hidden="true" />
          Redacted. The request text was not retained — this entry shows the policy category
          and reason only.
        </p>
      )}
      {policy.verdict === 'escalate' && (
        <p className="mt-1.5 text-[10.5px] leading-relaxed">
          Held for human review. Nothing auto-approves an escalation.
        </p>
      )}
    </article>
  );
}
