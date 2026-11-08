/**
 * One pipeline run, as a surface may render it.
 *
 * `lib/agents` returns an append-only DAG of typed deltas; every surface needs
 * the same two things from it — the seven checks as an ordered run list, and
 * the gate's outcome — and each had derived them separately. Deriving them
 * three times means three chances to leak the request text, so this is the one
 * place it happens.
 *
 * Two properties this module is responsible for:
 *
 * 1. **The request text has no field here.** Nothing in `RunView` can hold it,
 *    so no surface can render it. What survives is the policy category, the
 *    generic reason and the one-way digest (SPEC §7.3).
 * 2. **A block reads as a terminated run, not as a disclaimer.** Agents 3–7
 *    appear with status `not-run` because the gate stopped the pipeline —
 *    the absence of their results is the visible evidence that the gate is
 *    structural (SPEC §7.4).
 *
 * Pure and framework-free: plain serialisable values, so a server component
 * can hand the result straight to a client one.
 */

import { latestOfKind, type Delta, type DeltaKind, type PipelineResult } from '@/lib/agents';
import { agentDeltaKind, pipelineStepsFor } from './steps';
import {
  isAssayPayload,
  isClassificationPayload,
  isConflictPayload,
  isTherapyMatchPayload,
  isEditPlanPayload,
  isIntentPayload,
  isOffTargetPayload,
  isScreenPayload,
  isStructuralPayload,
  isVerdictPayload,
} from '@/lib/agents/types';
import { ASSAY_MODEL_LIMITATION } from '@/lib/cellsim';
import type { SimMetrics } from '@/lib/cellsim';
import type { PolicyCategory, Verdict } from '@/lib/safety/policy';

/**
 * `not-run` is distinct from `skipped`: it means the gate ended the run before
 * this agent, which is a result in itself.
 */
export type StepStatus = 'passed' | 'failed' | 'blocked' | 'escalated' | 'warning' | 'not-run';

export interface StepDetail {
  readonly label: string;
  readonly value: string;
}

export interface StepView {
  readonly agent: string;
  /** 1-based position in the fixed order of SPEC §4.3. */
  readonly step: number;
  readonly kind: DeltaKind;
  readonly status: StepStatus;
  /** Generic and request-independent. Never contains the request text. */
  readonly summary: string;
  readonly details: readonly StepDetail[];
  /** What this check does not establish, where that matters. */
  readonly limitation: string | null;
  readonly deltaId: string | null;
}

/** The gate's outcome, reduced to what may cross a trust boundary. */
export interface ScreenView {
  readonly category: PolicyCategory;
  readonly verdict: Verdict;
  readonly reason: string;
  readonly requiresSignoff: boolean;
  readonly signoffRole: string | null;
  /**
   * Curated gene symbols only, and dropped entirely for a redacted verdict.
   * The pipeline resolves symbols from an allow-list, so this field cannot
   * carry free text — dropping it anyway is the second lock on that door.
   */
  readonly flaggedGenes: readonly string[];
  readonly requestDigest: string;
  readonly redacted: boolean;
}

export interface DeltaView {
  readonly id: string;
  readonly kind: DeltaKind;
  readonly author: string;
  readonly subject: string;
  readonly parents: readonly string[];
  readonly createdAt: number;
  /** Pretty-printed payload, for the expandable audit trail. */
  readonly payload: string;
}

export type RunConclusion = 'passed' | 'failed' | 'blocked' | 'escalated';

export interface RunView {
  readonly id: string;
  readonly steps: readonly StepView[];
  readonly deltas: readonly DeltaView[];
  readonly screen: ScreenView;
  readonly conclusion: RunConclusion;
  readonly blocked: boolean;
  readonly escalated: boolean;
  readonly passed: boolean;
  readonly mergeAllowed: boolean;
  readonly requiresSignoff: boolean;
  readonly signoffRole: string | null;
  /** How far the run got, 0–7. Less than 7 means the gate stopped it. */
  readonly agentsRun: number;
  /** What the verifier actually measured, when the assay ran. */
  readonly measured: {
    readonly highPO2: SimMetrics | null;
    readonly lowPO2: SimMetrics | null;
    readonly referenceLowPO2: SimMetrics | null;
  } | null;
}

const STRUCTURAL_LIMITATION =
  'Curated annotation from the fixture, not a structural prediction.';

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function num(value: number): string {
  return value.toFixed(3);
}

function screenView(result: PipelineResult): ScreenView {
  const delta = latestOfKind(result.dag.all(), 'screen');
  if (delta === undefined || !isScreenPayload(delta.payload)) {
    throw new Error('run-view: the run has no biosafety screen delta');
  }
  const payload = delta.payload;
  return {
    category: payload.category,
    verdict: payload.verdict,
    reason: payload.reason,
    requiresSignoff: payload.requiresSignoff,
    signoffRole: payload.signoffRole ?? null,
    flaggedGenes: payload.redacted ? [] : [...payload.flaggedGenes],
    requestDigest: payload.requestDigest,
    redacted: payload.redacted,
  };
}

function intentStep(
  delta: Delta,
  screen: ScreenView,
): Omit<StepView, 'agent' | 'step' | 'kind'> | null {
  // `isIntentPayload` is the module's own guard. Asserting the shape with a
  // cast would prove the array exists but not that its elements are strings,
  // and they are rendered with `join`.
  if (!isIntentPayload(delta.payload)) return null;
  const targets = delta.payload.targets.filter(
    (target): target is string => typeof target === 'string',
  );
  return {
    status: targets.length > 0 ? 'passed' : 'warning',
    summary:
      targets.length > 0
        ? `Resolved ${targets.length} curated target${targets.length === 1 ? '' : 's'}.`
        : 'No curated target locus could be resolved from the request.',
    details: [
      // Withheld for a refused request: the resolved symbols are a description
      // of what was asked (SPEC §7.3). The `screen` step's flagged-loci row is
      // gated the same way.
      {
        label: 'targets',
        value: screen.redacted ? 'withheld' : targets.length > 0 ? targets.join(', ') : '—',
      },
      { label: 'request digest', value: screen.requestDigest },
    ],
    limitation:
      'Structured intent only. The request is reduced to allow-listed gene symbols and a one-way digest; the text itself is not retained.',
    deltaId: delta.id,
  };
}

function stepFor(
  agent: string,
  delta: Delta | undefined,
  result: PipelineResult,
  screen: ScreenView,
  classified: boolean,
): StepView {
  const kind = agentDeltaKind(agent) ?? 'intent';
  // Numbered by the order this run actually executed, so the verifier is
  // step 7 on a seven-agent run and step 9 on a classified one.
  const step = pipelineStepsFor(classified).find((spec) => spec.agent === agent)?.step ?? 0;

  if (delta === undefined) {
    return {
      agent,
      step,
      kind,
      status: 'not-run',
      summary: result.blocked
        ? 'Not executed — the biosafety gate ended the run at step 2.'
        : 'Not executed.',
      details: [],
      limitation: null,
      deltaId: null,
    };
  }

  const base = { agent, step, kind };

  switch (kind) {
    case 'intent': {
      const projected = intentStep(delta, screen);
      if (projected === null) break;
      return { ...base, ...projected };
    }

    case 'screen': {
      const status: StepStatus =
        screen.verdict === 'block'
          ? 'blocked'
          : screen.verdict === 'escalate'
            ? 'escalated'
            : 'passed';
      const details: StepDetail[] = [
        { label: 'category', value: screen.category },
        { label: 'verdict', value: screen.verdict },
        { label: 'request digest', value: screen.requestDigest },
      ];
      if (screen.signoffRole !== null) {
        details.push({ label: 'sign-off role', value: screen.signoffRole });
      }
      if (screen.flaggedGenes.length > 0) {
        details.push({ label: 'flagged loci', value: screen.flaggedGenes.join(', ') });
      }
      return {
        ...base,
        status,
        summary: screen.reason,
        details,
        limitation:
          'The screen is lexical: it matches wording and curated gene symbols. It over-blocks, and a rephrased request can evade it.',
        deltaId: delta.id,
      };
    }

    case 'edit_plan': {
      if (!isEditPlanPayload(delta.payload)) break;
      const p = delta.payload;
      return {
        ...base,
        status: p.resolved ? 'passed' : 'warning',
        summary: p.note,
        details: [
          { label: 'gene', value: p.gene ?? '—' },
          { label: 'variant', value: p.variantLabel ?? p.variantId ?? '—' },
          {
            label: 'codon',
            value:
              p.codonIndex === null
                ? '—'
                : `${p.codonIndex} ${p.refCodon ?? '???'}→${p.altCodon ?? '???'}`,
          },
          { label: 'genotype', value: p.genotypeLabel ?? '—' },
        ],
        limitation: null,
        deltaId: delta.id,
      };
    }

    case 'structural': {
      if (!isStructuralPayload(delta.payload)) break;
      const p = delta.payload;
      return {
        ...base,
        status: p.sourcedFromFixture ? 'passed' : 'warning',
        summary: p.summary,
        details: [
          {
            label: 'substitution',
            value:
              p.refAa === null || p.altAa === null
                ? '—'
                : `${p.refAaName ?? p.refAa} → ${p.altAaName ?? p.altAa}`,
          },
          { label: 'consequence', value: p.consequence },
          {
            label: 'polymerisation tendency',
            value: p.polymerizationTendency === null ? '—' : num(p.polymerizationTendency),
          },
          { label: 'confidence', value: p.confidence ?? '—' },
        ],
        limitation: p.limitation.length > 0 ? p.limitation : STRUCTURAL_LIMITATION,
        deltaId: delta.id,
      };
    }

    case 'assay': {
      if (!isAssayPayload(delta.payload)) break;
      const p = delta.payload;
      const m = p.metrics;
      return {
        ...base,
        status: p.ran ? (p.assessment === 'flow_impaired' ? 'warning' : 'passed') : 'warning',
        summary: p.ran
          ? `Headless run complete — ${p.assessment.replace(/_/g, ' ')}.`
          : 'The assay did not run; no genotype was resolved.',
        details:
          m === null
            ? [{ label: 'metrics', value: '—' }]
            : [
                { label: 'pO₂', value: p.params === null ? '—' : String(p.params.pO2) },
                { label: 'occlusion', value: pct(m.occlusion) },
                { label: 'mean flow', value: num(m.meanFlow) },
                { label: 'sickled fraction', value: pct(m.sickledFraction) },
              ],
        limitation: p.limitation.length > 0 ? p.limitation : ASSAY_MODEL_LIMITATION,
        deltaId: delta.id,
      };
    }

    case 'offtarget': {
      if (!isOffTargetPayload(delta.payload)) break;
      const p = delta.payload;
      return {
        ...base,
        status: p.hits.length > 0 ? 'warning' : 'passed',
        summary:
          p.hits.length > 0
            ? `${p.hits.length} target${p.hits.length === 1 ? '' : 's'} appear in the curated sensitive-locus registry.`
            : 'No target appears in the curated sensitive-locus registry.',
        details:
          p.hits.length > 0
            ? p.hits.map((h) => ({ label: h.gene, value: `${h.classification} — ${h.note}` }))
            : [{ label: 'method', value: 'curated registry lookup' }],
        limitation:
          'A lookup against a short curated registry, not an off-target search. Absence here is not evidence of specificity.',
        deltaId: delta.id,
      };
    }

    case 'verdict': {
      if (!isVerdictPayload(delta.payload)) break;
      const p = delta.payload;
      const details: StepDetail[] = [];
      if (p.measured.lowPO2 !== null) {
        details.push({
          label: 'occlusion at low pO₂',
          value: pct(p.measured.lowPO2.occlusion),
        });
      }
      if (p.measured.referenceLowPO2 !== null) {
        details.push({
          label: 'reference at low pO₂',
          value: pct(p.measured.referenceLowPO2.occlusion),
        });
      }
      if (p.disagreedWithAssay) {
        details.push({ label: 'disagreement', value: 'Contradicts the assay agent' });
      }
      if (p.disagreedWithStructural) {
        details.push({ label: 'disagreement', value: 'Contradicts the structural agent' });
      }
      for (const reason of p.reasons) {
        details.push({ label: 'reason', value: reason });
      }
      return {
        ...base,
        status: p.passed ? 'passed' : 'failed',
        summary: p.passed
          ? 'Measured output supports the claimed effect.'
          : 'Measured output does not support the claimed effect.',
        details,
        limitation:
          'The verifier re-runs the same illustrative model at low pO₂. It checks internal consistency, not biological truth.',
        deltaId: delta.id,
      };
    }
    case 'classification': {
      if (!isClassificationPayload(delta.payload)) break;
      const p = delta.payload;
      const details: StepDetail[] = [
        { label: 'classification', value: p.classification ?? '—' },
        { label: 'points', value: p.points === null ? '—' : String(p.points) },
        {
          label: 'criteria',
          value: p.criteria.length === 0 ? '—' : p.criteria.map((c) => c.code).join(', '),
        },
      ];
      if (p.hgvs !== null) details.push({ label: 'hgvs', value: p.hgvs });
      if (p.priorClassification !== null) {
        details.push({ label: 'prior call', value: p.priorClassification });
      }
      details.push({ label: 'citation', value: p.citation });
      return {
        ...base,
        status: p.classified ? 'passed' : 'warning',
        summary: p.note,
        details,
        // The scope caveat travels with the classification, so a surface
        // cannot show the call without it.
        limitation: p.limitation,
        deltaId: delta.id,
      };
    }

    case 'conflict': {
      if (!isConflictPayload(delta.payload)) break;
      const p = delta.payload;
      return {
        ...base,
        status: !p.assessed ? 'warning' : p.crossesActionableThreshold ? 'escalated' : 'passed',
        summary: p.note,
        details: [
          { label: 'prior call', value: p.priorClassification ?? '—' },
          { label: 'new call', value: p.newClassification ?? '—' },
          { label: 'disagrees', value: p.conflict ? 'yes' : 'no' },
          {
            label: 'crosses actionable threshold',
            value: p.crossesActionableThreshold ? 'yes — sign-off required' : 'no',
          },
        ],
        limitation: p.limitation,
        deltaId: delta.id,
      };
    }

    case 'therapy_match': {
      if (!isTherapyMatchPayload(delta.payload)) break;
      const p = delta.payload;
      return {
        ...base,
        status: 'passed',
        summary: p.note,
        details: [
          { label: 'classification', value: p.classification },
          { label: 'result', value: p.result },
          {
            label: 'therapies',
            value:
              p.therapies.length === 0
                ? 'none in the curated table'
                : p.therapies.map((t) => t.name).join(', '),
          },
          { label: 'disclaimer', value: p.disclaimer },
        ],
        limitation: p.limitation,
        deltaId: delta.id,
      };
    }
  }

  // A delta exists but its payload did not match the expected shape. Report
  // that rather than rendering a confident-looking empty row.
  return {
    ...base,
    status: 'warning',
    summary: 'This agent emitted a delta whose payload shape was not recognised.',
    details: [],
    limitation: null,
    deltaId: delta.id,
  };
}

function conclusionOf(result: PipelineResult): RunConclusion {
  if (result.blocked) return 'blocked';
  if (result.escalated) return 'escalated';
  return result.passed ? 'passed' : 'failed';
}

/**
 * Kinds whose payload describes the request rather than a derived result.
 *
 * `intent` carries the parsed targets and operation; `screen` carries the
 * flagged loci. For an allowed request those are exactly the audit trail a
 * reviewer wants. For a refused one they are a description of what was asked —
 * `operation: 'repair'` is a paraphrase of the ask, not a policy category — and
 * SPEC §7.3 permits only the category and a generic reason.
 */
const REQUEST_SHAPED_KINDS: readonly DeltaKind[] = ['intent', 'screen'];

const WITHHELD = '"payload withheld — this request was refused and is not retained"';

/**
 * Project a delta for display.
 *
 * `screenView` drops `flaggedGenes` on redaction, and dumping the raw payload
 * here would put them straight back on screen — which is what it did. The
 * structure of the trail stays visible either way: a reviewer can still see
 * that seven deltas exist, who emitted them and how they are threaded.
 */
function deltaViews(deltas: readonly Delta[], redacted: boolean): readonly DeltaView[] {
  return deltas.map((d) => ({
    id: d.id,
    kind: d.kind,
    author: d.author,
    subject: d.subject,
    parents: [...d.parents],
    createdAt: d.createdAt,
    payload:
      redacted && REQUEST_SHAPED_KINDS.includes(d.kind)
        ? WITHHELD
        : JSON.stringify(d.payload, null, 2),
  }));
}

/** Project a pipeline run onto the shape every surface renders. */
export function runView(result: PipelineResult): RunView {
  const deltas = result.dag.all();
  const screen = screenView(result);

  // Read from the run, not inferred from its deltas: a blocked classified run
  // emits no classification, and it must still show the three stages the gate
  // stopped as "not executed" rather than pretending they were never part of
  // the pipeline.
  const classified = result.classified;
  const steps = pipelineStepsFor(classified).map((spec) =>
    stepFor(spec.agent, latestOfKind(deltas, spec.kind), result, screen, classified),
  );

  const verdict = latestOfKind(deltas, 'verdict');
  const measured =
    verdict !== undefined && isVerdictPayload(verdict.payload) ? verdict.payload.measured : null;

  return {
    id: result.headId,
    steps,
    deltas: deltaViews(deltas, screen.redacted),
    screen,
    conclusion: conclusionOf(result),
    blocked: result.blocked,
    escalated: result.escalated,
    passed: result.passed,
    mergeAllowed: result.mergeAllowed,
    requiresSignoff: result.requiresSignoff,
    signoffRole: result.signoffRole ?? null,
    agentsRun: steps.filter((s) => s.status !== 'not-run').length,
    measured,
  };
}

export {
  AGENT_ORDER,
  CLASSIFIED_PIPELINE_STEPS,
  PIPELINE_STEPS,
  agentDeltaKind,
  agentRole,
  pipelineStepsFor,
  type AgentName,
  type PipelineStepSpec,
} from './steps';
