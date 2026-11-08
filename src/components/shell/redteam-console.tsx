'use client';

/**
 * The red-team console.
 *
 * A free-text box whose contents are screened by `lib/safety`' `screen()`
 * **server-side**, via `screenRequestAction`. The policy module is never
 * bundled for the browser and the verdict is never computed here.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SPEC §7.3 is binding on this component.
 *
 * For a `redacted` (block-class) verdict the UI renders the policy category
 * and the generic reason **only**. It does not echo the request, restate it,
 * or keep it.
 *
 * The enforcement is structural rather than a rule this file remembers:
 *  - `ScreenView.echo` arrives as `null` for every redacted verdict, nulled on
 *    the server, so the text is not in the props at all.
 *  - The textarea is cleared on submit and the submitted string is never put
 *    into component state, so a redacted request is not held in the client
 *    either — not in the log, not in a ref, not in the input.
 *  - The log renders `entry.echo` and nothing else; there is no code path from
 *    a user keystroke to a rendered string other than that field.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { useId, useState, useTransition } from 'react';
import {
  Fingerprint,
  Loader2,
  ShieldAlert,
  SquareAsterisk,
  TriangleAlert,
} from 'lucide-react';

import { screenRequestAction } from '@/app/actions';
import type { ScreenView } from './model/types';
import { StatusMark } from './status';
import type { StatusTone } from './status';

export interface RedTeamConsoleProps {
  /**
   * The example request shown in the empty field, derived from the locus by
   * the caller. SPEC §5 forbids placeholder content, and a typed-in gene
   * symbol and codon index would go stale silently when the fixture changes.
   */
  readonly example: string;
  /** Notified when a screened request produced a full pipeline run. */
  readonly onRun?: (view: ScreenView) => void;
}

function toneForVerdict(view: ScreenView): StatusTone {
  switch (view.verdict) {
    case 'block':
      return 'blocked';
    case 'escalate':
      return 'escalated';
    case 'allow':
      return 'passed';
  }
}

function verdictWord(view: ScreenView): string {
  switch (view.verdict) {
    case 'block':
      return 'Blocked';
    case 'escalate':
      return 'Escalated';
    case 'allow':
      return 'Passed';
  }
}

export function RedTeamConsole({ example, onRun }: RedTeamConsoleProps) {
  const [entries, setEntries] = useState<readonly ScreenView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();

  function submit(form: HTMLFormElement): void {
    const field = form.elements.namedItem('request');
    if (!(field instanceof HTMLTextAreaElement)) return;
    const text = field.value.trim();
    if (text.length === 0) return;

    // Clear immediately. The submitted string is handed straight to the
    // server action and is never stored in component state, so a request the
    // policy refuses leaves no copy on the client.
    field.value = '';
    setError(null);

    startTransition(async () => {
      try {
        const view = await screenRequestAction({ text, seq: entries.length + 1 });
        setEntries((prev) => [view, ...prev]);
        if (view.run !== null) onRun?.(view);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Screening failed.');
      }
    });
  }

  return (
    <section className="rt" aria-labelledby="rt-heading">
      <h2 className="rt__head" id="rt-heading">
        <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
        Red-team console
      </h2>

      <p className="rt__note">
        Type a request. It is screened by the biosafety gate on the server before any
        downstream agent runs. Refused requests are reported by policy category only —
        the text is not stored or echoed back.
      </p>

      <form
        className="rt__form"
        onSubmit={(event) => {
          event.preventDefault();
          submit(event.currentTarget);
        }}
      >
        <label className="sr-only" htmlFor={inputId}>
          Request to screen
        </label>
        <textarea
          id={inputId}
          name="request"
          className="rt__input"
          rows={2}
          placeholder={example}
          onKeyDown={(event) => {
            // ⌘/Ctrl+Enter submits; plain Enter keeps a newline, because a
            // request can reasonably run to two lines.
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              const form = event.currentTarget.form;
              if (form !== null) submit(form);
            }
          }}
        />
        <button type="submit" className="rt__send" disabled={pending}>
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
          ) : null}
          {pending ? 'Screening' : 'Screen'}
        </button>
      </form>

      {error === null ? null : (
        <p className="rt__note status--failed" role="alert">
          {error}
        </p>
      )}

      {/* Results are announced politely: a judge typing into the box should
          hear the verdict without having to go looking for it. */}
      <ul className="rt__log" role="list" aria-live="polite" aria-atomic="false">
        {entries.map((entry) => {
          const tone = toneForVerdict(entry);
          return (
            <li className={`rt__entry status--${tone}`} key={`${entry.seq}-${entry.requestDigest}`}>
              <div className="rt__entry-head">
                <StatusMark tone={tone} label={verdictWord(entry)} />
                <span className="rt__category">{entry.category.replace(/_/g, ' ')}</span>
              </div>

              <p className="rt__reason">{entry.reason}</p>

              {entry.flaggedGenes.length > 0 ? (
                <p className="rt__digest">
                  Flagged loci: <span className="seq">{entry.flaggedGenes.join(', ')}</span>
                </p>
              ) : null}

              {entry.requiresSignoff && entry.signoffRole !== null ? (
                <p className="rt__digest flex items-center gap-1.5">
                  <TriangleAlert className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
                  Requires sign-off by {entry.signoffRole.replace(/_/g, ' ')}. Nothing
                  auto-approves an escalation.
                </p>
              ) : null}

              {/* Either the request, when policy allows showing it, or an
                  explicit statement that it was discarded — never a blank. */}
              {/* `ScreenView` is a discriminated union, so in the redacted arm
                  `echo` is typed `null` — there is no branch here that could
                  render a refused request even by mistake. */}
              {entry.redacted ? (
                <p className="rt__redacted">
                  <SquareAsterisk className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
                  Request withheld by policy. Not stored, not logged, not echoed.
                </p>
              ) : (
                <p className="rt__digest">
                  <span className="not-italic">Request:</span> {entry.echo}
                </p>
              )}

              <p className="rt__digest flex items-center gap-1.5">
                <Fingerprint className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
                digest <span className="seq">{entry.requestDigest}</span>
                {entry.run === null ? (
                  <span>· pipeline terminated at the gate</span>
                ) : (
                  <span>· {entry.run.deltaCount} deltas recorded</span>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
