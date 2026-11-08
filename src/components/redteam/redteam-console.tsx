'use client';

/**
 * Control input: the red-team console.
 *
 * Text is posted to a Server Function that runs `lib/safety.screen()`. Only a
 * category, a generic reason and a digest come back — the request text is
 * never returned, re-rendered or logged, and on a refusal the field is
 * cleared so the refused wording is not left on screen. See SPEC.md §7.3.
 */

import { useActionState, useEffect, useRef } from 'react';
import {
  Ban,
  Fingerprint,
  Loader2,
  OctagonX,
  SendHorizontal,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from 'cn';
import { screenRequestAction, type RedTeamState } from '@/app/actions';

const INITIAL: RedTeamState = { result: null, submissions: 0, error: null };

export function RedTeamConsole() {
  const [state, formAction, pending] = useActionState(screenRequestAction, INITIAL);
  const formRef = useRef<HTMLFormElement | null>(null);
  const lastHandled = useRef(0);

  // A refused request leaves nothing behind in the input.
  useEffect(() => {
    if (state.submissions !== lastHandled.current) {
      lastHandled.current = state.submissions;
      if (state.result?.redacted === true) formRef.current?.reset();
    }
  }, [state.submissions, state.result]);

  const result = state.result;
  const tone =
    result === null
      ? 'border-bezel-edge/60'
      : result.verdict === 'block'
        ? 'border-signal-alarm/60'
        : result.verdict === 'escalate'
          ? 'border-signal-warn/60'
          : 'border-signal-ok/60';

  return (
    <section
      aria-labelledby="redteam-heading"
      className={cn('recess-surface space-y-3 rounded-xl border p-4', tone)}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="redteam-heading"
            className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
          >
            <OctagonX className="size-3.5" aria-hidden="true" />
            Control input · red team
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Type any request. It is screened by <span className="font-mono">lib/safety</span>{' '}
            before the pipeline runs. Refused text is not stored or echoed back.
          </p>
        </div>

        {/* Hard-stop indicator. */}
        <div
          className={cn(
            'flex shrink-0 flex-col items-center gap-1 rounded-md border px-2.5 py-1.5',
            result?.verdict === 'block'
              ? 'border-signal-alarm/60 bg-signal-alarm/15'
              : 'border-bezel-edge/60 bg-background/50',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-3 rounded-full',
              result?.verdict === 'block'
                ? 'bg-signal-alarm shadow-[0_0_10px_var(--signal-alarm)]'
                : 'bg-muted-foreground/30',
            )}
          />
          <span className="text-[0.5625rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
            Hard stop
          </span>
        </div>
      </div>

      <form ref={formRef} action={formAction} className="space-y-2">
        <Label htmlFor="redteam-request" className="text-xs">
          Request
        </Label>
        <Textarea
          id="redteam-request"
          name="request"
          rows={3}
          required
          placeholder="e.g. Correct the HBB codon 7 substitution in somatic cells to treat sickle cell disease."
          className="bg-background/70 font-mono text-xs"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-[0.625rem] text-muted-foreground">
            Screening is deterministic and keyword-based — auditable, but it over-blocks on
            innocent phrasing and can be evaded by paraphrase. It is not a biosafety review.
          </p>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <SendHorizontal className="size-3.5" aria-hidden="true" />
            )}
            Screen
          </Button>
        </div>
      </form>

      {state.error !== null ? (
        <p role="alert" className="text-xs text-signal-alarm">
          {state.error}
        </p>
      ) : null}

      <div aria-live="polite" className="space-y-2">
        {result !== null ? (
          <div
            className={cn(
              'rounded-lg border p-3',
              result.verdict === 'block'
                ? 'border-signal-alarm/60 bg-signal-alarm/10'
                : result.verdict === 'escalate'
                  ? 'border-signal-warn/60 bg-signal-warn/10'
                  : 'border-signal-ok/60 bg-signal-ok/10',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              {result.verdict === 'block' ? (
                <Ban className="size-4 text-signal-alarm" aria-hidden="true" />
              ) : result.verdict === 'escalate' ? (
                <TriangleAlert className="size-4 text-signal-warn" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4 text-signal-ok" aria-hidden="true" />
              )}
              <span
                className={cn(
                  'tnum font-mono text-sm font-semibold',
                  result.verdict === 'block'
                    ? 'text-signal-alarm'
                    : result.verdict === 'escalate'
                      ? 'text-signal-warn'
                      : 'text-signal-ok',
                )}
              >
                {result.verdict === 'block'
                  ? 'BLOCKED'
                  : result.verdict === 'escalate'
                    ? 'ESCALATED'
                    : 'ALLOWED'}
              </span>
              <Badge variant="outline" className="tnum font-mono">
                {result.category}
              </Badge>
              {result.redacted ? <Badge variant="destructive">request discarded</Badge> : null}
            </div>

            <p className="mt-2 text-xs">{result.reason}</p>

            {result.requiresSignoff ? (
              <p className="mt-1.5 text-xs text-signal-warn">
                Blocks the merge until a named human signs off
                {result.signoffRole !== null ? `: ${result.signoffRole}` : ''}. Nothing
                auto-approves an escalation.
              </p>
            ) : null}

            {result.flaggedGenes.length > 0 ? (
              <p className="tnum mt-1.5 font-mono text-[0.6875rem] text-muted-foreground">
                flagged loci: {result.flaggedGenes.join(', ')}
              </p>
            ) : null}

            <p className="tnum mt-1.5 flex items-center gap-1.5 font-mono text-[0.625rem] text-muted-foreground">
              <Fingerprint className="size-3" aria-hidden="true" />
              request digest {result.requestDigest}
              {result.redacted
                ? ' · the request text itself was not retained, logged or displayed'
                : ''}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No request screened in this session.
          </p>
        )}
      </div>
    </section>
  );
}
