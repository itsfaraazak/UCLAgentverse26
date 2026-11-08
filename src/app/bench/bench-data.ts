/**
 * Server-side assembly of the bench's data. Runs on the server only: it
 * touches `lib/vcs`, `lib/agents` and `lib/merge-gate`, which use
 * `node:crypto`.
 *
 * Every number handed to the client comes from a real module call — `Repo`
 * for oids and branches, `diffSequences` for the registers, `runPipeline`
 * for the checks, `evaluateMerge` for the gate.
 */

import {
  diffSequences,
  getGenotype,
  getLocus,
  referenceSequence,
  sequenceForGenotype,
  translate,
  type DiffRow,
  type Locus,
  type LocusVariant,
  type Sequence,
} from '@/lib/genome';
import { Repo, type MergeConflict, type Oid } from '@/lib/vcs';
import {
  latestOfKind,
  pipelineAgentOrder,
  runPipeline,
  type Delta,
  type PipelineResult,
} from '@/lib/agents';
import {
  isAssayPayload,
  isScreenPayload,
  isStructuralPayload,
  isVerdictPayload,
} from '@/lib/agents/types';
import {
  checkRunFromPipeline,
  evaluateMerge,
  introducedCommits,
  resolveSignoff,
  type CheckRun,
} from '@/lib/merge-gate';
import {
  ASSAY_MODEL_LIMITATION,
  CHALLENGE_STEPS,
  PO2_RANGE,
  SIMULATION_DEFAULTS,
  runAssay,
} from '@/lib/cellsim';
import type {
  BenchData,
  CheckRunView,
  CheckStepView,
  DeltaView,
  FrameView,
  MergeAttemptView,
  ScreenView,
  StepStatus,
  StructuralView,
} from './bench-types';

const GENE = 'HBB';
const AUTHOR = 'bench-operator';
/**
 * A sign-off is only ever as good as the name attached to it, so the name is
 * required and shape-checked here rather than defaulted. Previously this file
 * held a constant actor and stamped it whenever the client sent a boolean,
 * which is auto-approval wearing a human's clothes (SPEC §7.5).
 */
const APPROVER_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}'’. -]{1,119}$/u;

function approverOrNull(raw: string | null): string | null {
  if (raw === null) return null;
  const name = raw.trim().slice(0, 120);
  return APPROVER_PATTERN.test(name) ? name : null;
}

/** Content-addressed oids are shown twelve characters wide in the UI. */
function short(oid: Oid): string {
  return oid.slice(0, 12);
}

interface FrameSpec {
  id: string;
  role: 'reference' | 'mutant' | 'repaired';
  branch: string;
  genotypeId: string;
  message: string;
  variantId: string | null;
  /**
   * The request this frame submits to the agent pipeline. The pipeline
   * resolves its own intent from this text, exactly as the red-team console
   * does — there is no privileged path into the agents.
   */
  request: string;
}

const FRAME_SPECS: readonly FrameSpec[] = [
  {
    id: 'frame-reference',
    role: 'reference',
    branch: 'main',
    genotypeId: 'wildtype',
    message: 'reference: HBB coding region, HbA allele',
    variantId: null,
    request: 'Model the HBB reference allele with no edit applied.',
  },
  {
    id: 'frame-mutant',
    role: 'mutant',
    branch: 'observed/hbs',
    genotypeId: 'sickle',
    message: 'observed genotype: HbS substitution at codon 7',
    variantId: 'HBB_HbS',
    request: 'Introduce the HbS substitution at HBB codon 7.',
  },
  {
    id: 'frame-repaired',
    role: 'repaired',
    branch: 'therapy/hbb-repair',
    genotypeId: 'repaired',
    message: 'proposed edit: restore the reference codon at position 7',
    variantId: 'HBB_repair',
    request:
      'Repair the HBB codon 7 substitution in somatic cells to treat sickle cell disease.',
  },
];

function locusOrThrow(): Locus {
  const locus = getLocus(GENE);
  if (locus === undefined) throw new Error(`fixture missing: ${GENE}`);
  return locus;
}

function sequenceFor(locus: Locus, genotypeId: string): Sequence {
  const genotype = getGenotype(locus.gene, genotypeId);
  if (genotype === undefined) return referenceSequence(locus);
  return sequenceForGenotype(locus, genotype);
}

interface BuiltRepo {
  repo: Repo;
  heads: Map<string, Oid>;
  sequences: Map<string, Sequence>;
}

/**
 * Deterministic history: a reference commit on `main`, the observed genotype
 * on its own branch, and the proposed repair branched from the observed
 * state. The fixed epoch keeps oids reproducible across runs.
 */
function buildRepo(locus: Locus): BuiltRepo {
  const repo = new Repo();
  const heads = new Map<string, Oid>();
  const sequences = new Map<string, Sequence>();
  let timestamp = 1_767_225_600_000;

  const commitFor = (spec: FrameSpec, parentBranch: string | null): void => {
    const seq = sequenceFor(locus, spec.genotypeId);
    sequences.set(spec.id, seq);
    const blob = repo.write({ kind: 'blob', sequence: seq });
    const tree = repo.write({ kind: 'tree', entries: { [locus.gene]: blob } });

    const parent = parentBranch === null ? null : (heads.get(parentBranch) ?? null);
    if (parent !== null) {
      repo.branch(spec.branch, parent);
      repo.checkout(spec.branch);
    }

    const variant: LocusVariant | undefined =
      spec.variantId === null
        ? undefined
        : locus.variants.find((v) => v.id === spec.variantId);

    timestamp += 86_400_000;
    const oid = repo.commit({
      tree,
      parents: parent === null ? [] : [parent],
      author: AUTHOR,
      message: spec.message,
      timestamp,
      ...(variant ? { edit: variant } : {}),
    });
    heads.set(spec.branch, oid);
  };

  commitFor(FRAME_SPECS[0], null);
  commitFor(FRAME_SPECS[1], 'main');
  commitFor(FRAME_SPECS[2], 'observed/hbs');
  repo.checkout('main');

  return { repo, heads, sequences };
}

function toStructuralView(v: LocusVariant): StructuralView {
  return {
    refAa: v.structural.refAa,
    altAa: v.structural.altAa,
    refAaName: v.structural.refAaName,
    altAaName: v.structural.altAaName,
    summary: v.structural.summary,
    consequence: v.structural.consequence,
    polymerizationTendency: v.structural.polymerizationTendency,
    confidence: v.structural.confidence,
    limitation: v.structural.limitation,
  };
}

/**
 * Category, reason and digest only.
 *
 * `flaggedGenes` is dropped entirely for a redacted (block-class) verdict.
 * The pipeline only ever resolves curated gene symbols, so the field cannot
 * carry free text — this is the second lock on the same door (SPEC §7.3).
 */
function toScreenView(payload: unknown): ScreenView {
  if (!isScreenPayload(payload)) {
    throw new Error('bench-data: screen delta has an unexpected payload shape');
  }
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

function toDeltaView(d: Delta): DeltaView {
  return {
    id: d.id,
    kind: d.kind,
    author: d.author,
    subject: d.subject,
    parents: [...d.parents],
    createdAt: d.createdAt,
    payload: JSON.stringify(d.payload, null, 2),
  };
}

const KIND_FOR_AGENT: Readonly<Record<string, string>> = {
  IntentAgent: 'intent',
  BiosafetyGateAgent: 'screen',
  EditPlannerAgent: 'edit_plan',
  StructuralImpactAgent: 'structural',
  FunctionalAssayAgent: 'assay',
  OffTargetRiskAgent: 'offtarget',
  VerifierAgent: 'verdict',
};

function summarise(delta: Delta, screen: ScreenView): string {
  switch (delta.kind) {
    case 'intent':
      return `Intent normalised. Request digest ${screen.requestDigest}.`;
    case 'screen':
      return `${screen.category} → ${screen.verdict.toUpperCase()}. ${screen.reason}`;
    case 'edit_plan': {
      const p = delta.payload as { resolved?: boolean; note?: string };
      return p.resolved === true
        ? (p.note ?? 'Edit plan resolved against the curated fixture.')
        : 'No curated locus could be resolved from the request.';
    }
    case 'structural': {
      if (!isStructuralPayload(delta.payload)) return 'Structural annotation recorded.';
      return delta.payload.summary;
    }
    case 'assay': {
      if (!isAssayPayload(delta.payload) || delta.payload.metrics === null) {
        return 'Functional assay did not run.';
      }
      const m = delta.payload.metrics;
      return (
        `Occlusion ${m.occlusion.toFixed(3)}, sickled fraction ` +
        `${m.sickledFraction.toFixed(3)}, mean flow ${m.meanFlow.toFixed(3)}.`
      );
    }
    case 'offtarget': {
      const p = delta.payload as { hits?: readonly { gene: string }[] };
      const hits = p.hits ?? [];
      return hits.length === 0
        ? 'No flagged locus on the curated sensitive-locus registry.'
        : `Registry hits: ${hits.map((h) => h.gene).join(', ')}.`;
    }
    case 'verdict': {
      if (!isVerdictPayload(delta.payload)) return 'Verdict recorded.';
      return delta.payload.reasons.length > 0
        ? delta.payload.reasons.join(' ')
        : 'Measured metrics agree with the upstream agents.';
    }
    default:
      return delta.subject;
  }
}

function toCheckRunView(
  result: PipelineResult,
  requestedPO2: number,
  elapsedMs: number,
): CheckRunView {
  const deltas = result.dag.all();
  const screenDelta = latestOfKind(deltas, 'screen');
  if (screenDelta === undefined) {
    throw new Error('bench-data: pipeline produced no screen delta');
  }
  const screen = toScreenView(screenDelta.payload);

  const verdictDelta = latestOfKind(deltas, 'verdict');
  const verdict = isVerdictPayload(verdictDelta?.payload) ? verdictDelta.payload : null;
  const assayDelta = latestOfKind(deltas, 'assay');
  const assay = isAssayPayload(assayDelta?.payload) ? assayDelta.payload : null;
  const structuralDelta = latestOfKind(deltas, 'structural');
  const structural = isStructuralPayload(structuralDelta?.payload)
    ? structuralDelta.payload
    : null;

  const skippedReason =
    screen.verdict === 'block'
      ? 'Not run: the biosafety gate blocked this request.'
      : 'Not run.';

  const steps: CheckStepView[] = pipelineAgentOrder().map((agent, i) => {
    const kind = KIND_FOR_AGENT[agent] ?? 'intent';
    const delta = deltas.find((d) => d.author === agent && d.kind === kind);
    if (delta === undefined) {
      return {
        index: i + 1,
        agent,
        kind,
        status: 'skipped' as StepStatus,
        summary: skippedReason,
        deltaId: null,
      };
    }
    let status: StepStatus = 'pass';
    if (kind === 'screen') {
      status =
        screen.verdict === 'block'
          ? 'blocked'
          : screen.verdict === 'escalate'
            ? 'escalated'
            : 'pass';
    } else if (kind === 'verdict') {
      status = verdict?.passed === true ? 'pass' : 'fail';
    } else if (kind === 'edit_plan') {
      const p = delta.payload as { resolved?: boolean };
      status = p.resolved === true ? 'pass' : 'fail';
    } else if (kind === 'offtarget') {
      const p = delta.payload as { hits?: readonly unknown[] };
      status = (p.hits ?? []).length === 0 ? 'pass' : 'fail';
    }
    return {
      index: i + 1,
      agent,
      kind,
      status,
      summary: summarise(delta, screen),
      deltaId: delta.id,
    };
  });

  return {
    id: result.headId,
    verdict: result.blocked
      ? 'blocked'
      : result.escalated
        ? 'escalated'
        : result.passed
          ? 'pass'
          : 'fail',
    steps,
    deltas: deltas.map(toDeltaView),
    screen,
    elapsedMs,
    requestedPO2,
    requiresSignoff: result.requiresSignoff,
    signoffRole: result.signoffRole ?? null,
    mergeAllowed: result.mergeAllowed,
    verifierReasons: verdict === null ? [] : [...verdict.reasons],
    verifierDisagreedWithAssay: verdict?.disagreedWithAssay ?? false,
    verifierDisagreedWithStructural: verdict?.disagreedWithStructural ?? false,
    measuredHighPO2: verdict?.measured.highPO2 ?? null,
    measuredLowPO2: verdict?.measured.lowPO2 ?? null,
    measuredReferenceLowPO2: verdict?.measured.referenceLowPO2 ?? null,
    assayMetrics: assay?.metrics ?? null,
    assayAssessment: assay?.assessment ?? null,
    assayLimitation: assay?.limitation ?? null,
    structuralLimitation: structural?.limitation ?? null,
  };
}

function specOrThrow(frameId: string): FrameSpec {
  const spec = FRAME_SPECS.find((f) => f.id === frameId);
  if (spec === undefined) throw new Error(`unknown frame: ${frameId}`);
  return spec;
}

export function benchData(): BenchData {
  const locus = locusOrThrow();
  const { repo, heads, sequences } = buildRepo(locus);
  const reference = referenceSequence(locus);

  const frames: FrameView[] = FRAME_SPECS.map((spec, i) => {
    const seq = sequences.get(spec.id) ?? reference;
    const oid = heads.get(spec.branch);
    if (oid === undefined) throw new Error(`branch has no head: ${spec.branch}`);
    const commit = repo.read(oid);
    const genotype = getGenotype(locus.gene, spec.genotypeId);
    const variant =
      spec.variantId === null
        ? null
        : (locus.variants.find((v) => v.id === spec.variantId) ?? null);
    const prevSpec = i > 0 ? FRAME_SPECS[i - 1] : null;
    const prevSeq = prevSpec === null ? null : (sequences.get(prevSpec.id) ?? null);

    const diff: DiffRow[] = diffSequences(reference, seq);
    const diffFromPrevious: DiffRow[] = prevSeq === null ? diff : diffSequences(prevSeq, seq);

    return {
      id: spec.id,
      role: spec.role,
      label: genotype?.label ?? spec.genotypeId,
      branch: spec.branch,
      commitOid: oid,
      shortOid: short(oid),
      commitMessage: spec.message,
      parentShortOids: commit.kind === 'commit' ? commit.parents.map(short) : [],
      genotypeId: spec.genotypeId,
      provenance: variant?.provenance ?? locus.provenance,
      polymerizationTendency: genotype?.polymerizationTendency ?? 0,
      bases: seq.bases,
      protein: translate(seq.bases),
      diff,
      diffFromPrevious,
      previousLabel:
        prevSpec === null
          ? null
          : (getGenotype(locus.gene, prevSpec.genotypeId)?.label ?? null),
      changedCodonIndex: variant?.codonIndex ?? null,
      variantLabel: variant?.label ?? null,
      hgvs: variant?.hgvs ?? null,
      proteinHgvs: variant?.proteinHgvs ?? null,
      legacyName: variant?.legacyName ?? null,
      numberingNote: variant?.numberingNote ?? null,
      structural: variant === null ? null : toStructuralView(variant),
    };
  });

  const modelledEnd = locus.cdsReference.codonCount;

  return {
    locus: {
      gene: locus.gene,
      name: locus.name,
      chromosome: locus.chromosome,
      provenance: locus.provenance,
      note: locus.note,
      referenceLabel: locus.cdsReference.label,
      codonCount: locus.cdsReference.codonCount,
      exons: locus.exons.map((e) => ({
        index: e.index,
        label: e.label,
        codonStart: e.codonStart,
        codonEnd: e.codonEnd,
        modelled: e.codonStart <= modelledEnd,
        note: e.note,
      })),
    },
    frames,
    branches: repo.branches(),
    simulation: {
      seed: SIMULATION_DEFAULTS.seed,
      cellCount: SIMULATION_DEFAULTS.cellCount,
      pO2Default: SIMULATION_DEFAULTS.pO2,
      capillaryConstriction: SIMULATION_DEFAULTS.capillaryConstriction,
      pO2Min: PO2_RANGE.min,
      pO2Max: PO2_RANGE.max,
      pO2Unit: PO2_RANGE.unit,
      pO2Label: PO2_RANGE.label,
      sicklingOnsetBelow: PO2_RANGE.sicklingOnsetBelow,
      // The duration the pipeline's checks actually ran, not the module
      // default: the panel reported 260 while every check it displays ran
      // CHALLENGE_STEPS, which is a real figure from the wrong constant.
      assaySteps: CHALLENGE_STEPS,
      modelLimitation: ASSAY_MODEL_LIMITATION,
      referenceMeanFlow: runAssay({
        polymerizationTendency: 0,
        steps: CHALLENGE_STEPS,
      }).meanFlow,
    },
    disclaimer:
      'Illustrative model. The capillary simulation and the structural annotations are ' +
      'teaching summaries chosen to read clearly on screen; they are not calibrated ' +
      'haemorheology and not output from a validated structure-prediction model.',
  };
}

function pipelineFor(spec: FrameSpec, pO2: number): PipelineResult {
  return runPipeline({ text: spec.request, pO2, classify: true });
}

/** Run the seven-agent pipeline for one filmstrip frame. */
export function runChecksFor(frameId: string, pO2: number): CheckRunView {
  const spec = specOrThrow(frameId);
  const startedAt = performance.now();
  const result = pipelineFor(spec, pO2);
  return toCheckRunView(result, pO2, performance.now() - startedAt);
}

function conflictView(c: MergeConflict) {
  return {
    gene: c.gene,
    ours: c.ours === null ? null : short(c.ours),
    theirs: c.theirs === null ? null : short(c.theirs),
    base: c.base === null ? null : short(c.base),
  };
}

/**
 * Attempt to merge a frame's branch into `main` through `lib/merge-gate`.
 *
 * Every commit the merge would introduce must carry a passing check run, so
 * the checks run first and the gate — not this function — decides.
 */
export function attemptMergeFor(
  frameId: string,
  pO2: number,
  approver: string | null,
): MergeAttemptView {
  const locus = locusOrThrow();
  const spec = specOrThrow(frameId);
  const { repo, heads } = buildRepo(locus);

  const ours = heads.get('main');
  const theirs = heads.get(spec.branch);
  if (ours === undefined || theirs === undefined) {
    throw new Error('bench-data: branch head could not be resolved');
  }

  const base: MergeAttemptView = {
    ok: false,
    into: 'main',
    from: spec.branch,
    kind: null,
    reason: '',
    mergeOid: null,
    conflicts: [],
    blockingReasons: [],
    requiresSignoff: false,
    signoffRole: null,
  };

  if (spec.branch === 'main') {
    return { ...base, reason: 'This frame is the reference on `main`; nothing to merge.' };
  }

  // One check run per introduced commit, each from the real pipeline.
  const checks = new Map<string, CheckRun>();
  let requiresSignoff = false;
  let signoffRole: string | null = null;

  for (const oid of introducedCommits(repo, ours, theirs)) {
    const commit = repo.read(oid);
    const commitSpec =
      commit.kind === 'commit'
        ? (FRAME_SPECS.find((f) => f.message === commit.message) ?? spec)
        : spec;
    const result = pipelineFor(commitSpec, pO2);
    let check = checkRunFromPipeline({ commit: oid, result });
    if (result.requiresSignoff) {
      requiresSignoff = true;
      signoffRole = result.signoffRole ?? null;
      // `resolveSignoff` is the single authority: it derives the role from the
      // policy's own verdict, refuses a run that is not escalated, and refuses
      // an unnamed actor. The client sends a name and nothing else — it cannot
      // assert that a sign-off happened (SPEC §7.5).
      const named = approverOrNull(approver);
      if (named !== null) {
        const resolved = resolveSignoff(check, named);
        if (resolved.ok) check = resolved.check;
      }
    }
    // The gate looks a check up by `commit.checkRunId` or, failing that, by
    // the commit oid. These commits carry no checkRunId, so key by oid.
    checks.set(oid, check);
  }

  const decision = evaluateMerge({ repo, ours, theirs, checks });

  if (decision.allowed) {
    return {
      ...base,
      ok: true,
      reason: `Merged into main as ${short(decision.oid)} after a passing check run on every introduced commit.`,
      mergeOid: short(decision.oid),
      requiresSignoff,
      signoffRole,
    };
  }

  switch (decision.kind) {
    case 'content-conflict':
      return {
        ...base,
        kind: decision.kind,
        reason: 'Merge conflict: the genotype changed differently on both sides.',
        conflicts: decision.conflicts.map(conflictView),
      };
    case 'check-failed':
      return {
        ...base,
        kind: decision.kind,
        reason: 'Merge refused: a check run on an introduced commit did not pass.',
        blockingReasons: [...decision.reasons],
        requiresSignoff,
        signoffRole,
      };
    case 'awaiting-signoff':
      return {
        ...base,
        kind: decision.kind,
        reason:
          'Merge held: the gate escalated this edit and no named human sign-off is recorded.',
        requiresSignoff: true,
        signoffRole: decision.signoffRole,
      };
    case 'check-missing':
      return {
        ...base,
        kind: decision.kind,
        reason: `Merge refused: ${decision.commits.length} introduced commit(s) have no check run.`,
      };
  }
}
