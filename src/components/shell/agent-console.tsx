'use client';

/**
 * The agent run log — the CI panel of this product.
 *
 * Seven rows in the fixed order `lib/agents` declares, each expanding to the
 * delta that agent appended. Nothing here is a mock: a row's headline and
 * every key/value in its detail is projected from the real `Delta.payload` in
 * `model/workspace.ts`.
 *
 * The gate at position 2 is structural. When it blocks, agents 3–7 render as
 * `not run` rather than greyed-out-but-populated, because they genuinely did
 * not execute (SPEC §7.4).
 */

import { useState } from 'react';
import { ChevronDown, Fingerprint, TriangleAlert } from 'lucide-react';

import type { AgentStepView, RunView } from './model/types';
import { StatusMark, StatusPill, toneForCheck, toneForStep } from './status';

export interface AgentConsoleProps {
  readonly run: RunView;
  /** Shown above the log; omitted for the console's own ad-hoc runs. */
  readonly caption?: string;
}

export function AgentConsole({ run, caption }: AgentConsoleProps) {
  return (
    <div className="run">
      <div className="run__summary">
        <StatusPill tone={toneForCheck(run.check)} />
        <span className="text-[0.75rem] text-muted-foreground">
          {run.deltaCount} delta{run.deltaCount === 1 ? '' : 's'} ·{' '}
          {run.steps.filter((s) => s.outcome !== 'not-run').length}/{run.steps.length} agents ran
        </span>
        {run.requiresSignoff && run.signoffRole !== null ? (
          <span className="pill status--escalated">
            <TriangleAlert className="pill__icon" strokeWidth={2} aria-hidden="true" />
            Needs {run.signoffRole.replace(/_/g, ' ')}
          </span>
        ) : null}
      </div>

      <div className="run__request">
        <span className="run__request-label">
          {caption ?? 'Request screened by the gate'}
        </span>
        {run.request}
        <span className="mt-1.5 flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          <Fingerprint className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
          digest <span className="seq">{run.requestDigest}</span>
        </span>
      </div>

      {run.disagreedWithAssay || run.disagreedWithStructural ? (
        <p className="limitation mx-2 mb-1">
          <TriangleAlert className="limitation__icon" strokeWidth={1.75} aria-hidden="true" />
          <span>
            The verifier overruled an earlier agent on this run
            {run.disagreedWithAssay && run.disagreedWithStructural
              ? ' (both the functional assay and the structural annotation were optimistic).'
              : run.disagreedWithAssay
                ? ' (the functional assay was optimistic).'
                : ' (the structural annotation was optimistic).'}{' '}
            It re-ran the simulation itself rather than reading their prose.
          </span>
        </p>
      ) : null}

      <ol className="contents" role="list">
        {run.steps.map((step) => (
          <li key={step.position} className="contents">
            <AgentRow step={step} />
          </li>
        ))}
      </ol>

      <p className="limitation mx-2 mt-2">
        <TriangleAlert className="limitation__icon" strokeWidth={1.75} aria-hidden="true" />
        <span>{run.assayLimitation}</span>
      </p>
    </div>
  );
}

function AgentRow({ step }: { readonly step: AgentStepView }) {
  const [open, setOpen] = useState(false);
  const tone = toneForStep(step);
  const detailId = `agent-detail-${step.position}`;
  const expandable = step.detail.length > 0;

  return (
    <div className={`agent${step.outcome === 'not-run' ? ' agent--not-run' : ''}`}>
      <button
        type="button"
        className="agent__head"
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable ? detailId : undefined}
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="agent__position" aria-hidden="true">
          {step.position}
        </span>
        <StatusMark tone={tone} labelled={false} showDot={false} />
        <span className="agent__text">
          <span className="agent__name">{step.agent}</span>
          <span className="agent__headline">{step.headline}</span>
        </span>
        {expandable ? (
          <ChevronDown className="agent__chevron" strokeWidth={2} aria-hidden="true" />
        ) : null}
      </button>

      {open ? (
        <div className="agent__detail" id={detailId}>
          {step.role === '' ? null : <p className="agent__role m-0 ml-0">{step.role}</p>}
          {step.deltaId === null ? null : (
            <div className="agent__kv">
              <span className="agent__k">Delta</span>
              <span className="agent__v seq">{step.deltaId.slice(0, 16)}</span>
            </div>
          )}
          {step.createdAt === null ? null : (
            <div className="agent__kv">
              <span className="agent__k">Logical tick</span>
              <span className="agent__v">{step.createdAt}</span>
            </div>
          )}
          {step.detail.map((row, i) => (
            <div className="agent__kv" key={`${row.label}-${i}`}>
              <span className="agent__k">{row.label}</span>
              <span className={row.sequence === true ? 'agent__v seq' : 'agent__v'}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
