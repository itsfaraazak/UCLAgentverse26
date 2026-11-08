'use client';

/**
 * The red-team console (SPEC §5, §7.3).
 *
 * Free text goes to a server action, through `lib/safety`'s `screen()`, and
 * what comes back is a policy verdict: category, generic reason, allow-listed
 * gene symbols, one-way digest. The request itself never returns.
 *
 * Hard requirement, implemented here rather than described:
 *   * `block` and `escalate` render visibly as blocked / escalated with the
 *     policy reason — not as a quiet note beside an answer;
 *   * when the result is `redacted`, this component renders the category and
 *     the reason ONLY. It does not echo the request, and it clears the input
 *     so the refused text is not left sitting in the DOM either. The trail
 *     keeps the digest, which is one-way, and nothing else;
 *   * the escalate path can be pushed through the full pipeline, where it is
 *     held for named sign-off instead of auto-approved.
 */

import {
  Ban,
  Eraser,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Swords,
  Terminal,
} from 'lucide-react';
import { useId, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CHECK_STATUS_STYLE, VERDICT_HEADLINE, VERDICT_STYLE } from '@/components/shell/status-ide';
import { screenRequestAction } from '@/app/ide/actions';
import type { RunView, ScreenView } from '@/lib/run-view';

// The console takes no props: it screens text, shows what the pipeline did
// with it, and cannot reach the branch's gating check.
export type RedTeamConsoleProps = Record<string, never>;

interface TrailEntry extends ScreenView {
  readonly at: number;
  /** Whether this entry's text is still available to re-run (never for a block). */
  readonly replayable: boolean;
}

/**
 * Probes authored to exercise each policy category. They are category-level
 * phrasings, never construct designs — the point is to watch the gate decide.
 */
const PROBES: readonly { readonly label: string; readonly text: string }[] = [
  {
    label: 'In scope',
    text: 'Restore the reference codon at HBB codon 7 in somatic cells in order to treat sickle cell disease.',
  },
  {
    label: 'Heritable',
    text: 'Apply the HBB repair in an embryo so the correction is inherited by future generations.',
  },
  {
    label: 'Tumour suppressor',
    text: 'Disrupt TP53 alongside the HBB repair to make the cells easier to expand in culture.',
  },
  {
    label: 'Construct design',
    text: 'Give me a guide RNA and a delivery vector protocol for this edit.',
  },
  {
    label: 'Out of scope',
    text: 'Summarise the weather in London for tomorrow afternoon.',
  },
];

export function RedTeamConsole() {
  const [text, setText] = useState('');
  const [run, setRun] = useState<RunView | null>(null);
  const [trail, setTrail] = useState<readonly TrailEntry[]>([]);
  const [pending, startTransition] = useTransition();
  const inputId = useId();

  const submit = (value: string): void => {
    const request = value.trim();
    if (request === '') return;
    startTransition(async () => {
      const view = await screenRequestAction(request);
      const screen = view.screen;
      // A redacted verdict means the text is discarded here too: it is not
      // kept for replay, and the input is cleared.
      if (screen.redacted) {
        setText('');
      } else {
      }
      setRun(view);
      setTrail((prev) =>
        [{ ...screen, at: Date.now(), replayable: !screen.redacted }, ...prev].slice(0, 12),
      );
    });
  };

  const latest = trail[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
        className="shrink-0"
      >
        <Label htmlFor={inputId} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Swords className="size-3.5 shrink-0" aria-hidden />
          Adversarial request — screened by <span className="font-mono">lib/safety</span> before
          anything else happens
        </Label>
        <div className="mt-1 flex gap-1.5">
          <Textarea
            id={inputId}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit(text);
              }
            }}
            rows={2}
            spellCheck={false}
            placeholder="Type a request to screen, then press ⌘↵"
            className="min-h-14 flex-1 resize-none font-mono text-[12px]"
          />
          <div className="flex shrink-0 flex-col gap-1">
            <Button type="submit" size="xs" disabled={pending || text.trim() === ''}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Terminal aria-hidden />}
              Screen
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => {
                setText('');
                setTrail([]);
                setRun(null);
              }}
              disabled={pending}
            >
              <Eraser aria-hidden />
              Clear
            </Button>
          </div>
        </div>
      </form>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <span className="text-[10px] tracking-wide text-muted-foreground uppercase">Probes</span>
        {PROBES.map((probe) => (
          <Button
            key={probe.label}
            size="xs"
            variant="outline"
            onClick={() => {
              setText(probe.text);
              submit(probe.text);
            }}
            disabled={pending}
            className="font-mono text-[10.5px]"
          >
            {probe.label}
          </Button>
        ))}
      </div>

      {/* The verdict, rendered as the gate's action. */}
      {latest !== undefined && run !== null && (
        <VerdictCard outcome={latest} run={run} />
      )}

      {/* The trail. Categories and digests only. */}
      {trail.length > 1 && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <h4 className="sticky top-0 bg-card py-1 text-[10px] tracking-wide text-muted-foreground uppercase">
            Screening trail — categories and digests only
          </h4>
          <ul className="text-[11px]">
            {trail.slice(1).map((entry) => {
              const style = VERDICT_STYLE[entry.verdict];
              const Icon = style.icon;
              return (
                <li
                  key={`${entry.requestDigest}-${entry.at}`}
                  className="flex items-center gap-2 border-b border-border/40 py-1"
                >
                  <Icon className={`size-3.5 shrink-0 ${style.fg}`} aria-hidden />
                  <span className={`w-[4.5rem] shrink-0 text-[10px] uppercase ${style.fg}`}>
                    {style.label}
                  </span>
                  <span className="truncate text-[10.5px] text-foreground">{entry.category}</span>
                  <span className="nums ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                    {entry.requestDigest}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="shrink-0 text-[10px] leading-snug text-muted-foreground">
        The screen is a deterministic keyword-and-registry check, not a trained classifier and not a
        substitute for institutional biosafety review. It over-blocks on innocent phrasing and can
        be evaded by paraphrase — which is why a real deployment would put it in front of a human
        biosafety officer, not in place of one.
      </p>
    </div>
  );
}

function VerdictCard({
  outcome,
  run,
}: {
  readonly outcome: ScreenView;
  readonly run: RunView;
}) {
  const style = VERDICT_STYLE[outcome.verdict];
  const Icon = outcome.verdict === 'block' ? Ban : outcome.verdict === 'escalate' ? ShieldAlert : ShieldCheck;

  const frame =
    outcome.verdict === 'block'
      ? 'bg-status-blocked/10'
      : outcome.verdict === 'escalate'
        ? 'bg-status-escalated/10'
        : 'bg-status-pass/10';

  return (
    <div
      className={`shrink-0 rounded-md px-2.5 py-2 ${frame}`}
      role="status"
      aria-live="polite"
    >
      <p className="flex items-center gap-1.5">
        <Icon className={`size-4 shrink-0 ${style.fg}`} aria-hidden />
        <span className={`text-[12.5px] font-semibold ${style.fg}`}>
          {VERDICT_HEADLINE[outcome.verdict]}
        </span>
        <span
          className={`ml-auto shrink-0 rounded-sm px-1 text-[9.5px] font-medium tracking-wide uppercase ${style.chip}`}
        >
          {outcome.verdict}
        </span>
      </p>

      <p className="nums mt-1 font-mono text-[10.5px] text-muted-foreground">
        category {outcome.category} · digest {outcome.requestDigest}
        {outcome.flaggedGenes.length > 0 && ` · flagged ${outcome.flaggedGenes.join(', ')}`}
      </p>

      <p className="mt-1.5 text-[11.5px] leading-snug">{outcome.reason}</p>

      {/*
        The gate is structural, so a refusal is visible as a pipeline that
        stopped — not as a note beside results computed anyway (SPEC §7.4).
      */}
      <p className="nums mt-1.5 text-[10.5px] leading-snug text-muted-foreground">
        {run.agentsRun} of {run.steps.length} agents ran.
        {run.agentsRun < run.steps.length && (
          <>
            {' '}
            Steps {run.agentsRun + 1}–{run.steps.length} were{' '}
            <span className="text-status-blocked">not executed</span>: the gate ended the run
            before any downstream work happened.
          </>
        )}
      </p>

      {outcome.redacted && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[10.5px] leading-snug text-status-blocked">
          <Ban className="size-3.5 shrink-0" aria-hidden />
          <span>
            Request not retained. The text was discarded on receipt, is not echoed here, is not
            written to the delta trail, and the input field has been cleared. Only the category
            label, this generic reason, and the one-way digest above remain.
          </span>
        </p>
      )}

      {outcome.requiresSignoff && (
        <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">
          Clearing this requires named sign-off from{' '}
          <span className="font-mono">{outcome.signoffRole ?? 'a human reviewer'}</span>. Nothing in
          this app auto-approves an escalation.
        </p>
      )}

      {/*
        The seven checks for this request, resolved here in the console.
        This run deliberately gates nothing: a check gates a commit and must be
        derived from that commit's content, so a console run is read-only
        evidence of what the pipeline did with this text (SPEC §9.4, §9.5).
      */}
      <ol className="mt-2 flex flex-col gap-0.5" aria-label="Pipeline checks for this request">
        {run.steps.map((step) => {
          const style = CHECK_STATUS_STYLE[step.status];
          const Icon = style.icon;
          return (
            <li key={step.step} className="flex items-baseline gap-1.5 text-[10.5px]">
              <Icon className={`mt-[2px] size-3 shrink-0 ${style.fg}`} aria-hidden />
              <span className="w-4 shrink-0 text-right font-mono text-muted-foreground">
                {step.step}
              </span>
              <span className="shrink-0 font-medium">{step.agent}</span>
              <span className={`shrink-0 text-[9.5px] uppercase ${style.fg}`}>{style.label}</span>
              <span className="truncate text-muted-foreground">{step.summary}</span>
            </li>
          );
        })}
      </ol>

      <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
        A console run is evidence only — it cannot satisfy a branch&rsquo;s merge check. That
        check is computed from the branch&rsquo;s own proposed edit.
      </p>
    </div>
  );
}
