/**
 * Server-side composition: the single place where the shell's data comes from.
 *
 * SERVER ONLY. `lib/vcs`, `lib/agents` and `lib/safety` all reach
 * `node:crypto`, so nothing in this file may be imported from a client
 * component. The shell crosses the boundary with the plain view models in
 * `./types.ts`.
 *
 * The honest-data invariant this file exists to enforce: there is no branch
 * list, no commit graph, no check status and no metric anywhere in the UI that
 * was typed by hand. The repository below is *seeded* from `data/loci.json`
 * via `lib/genome` and `lib/vcs`, and every check run is a real
 * `runPipeline()` result passed through `checkRunFromPipeline()`.
 *
 * Determinism is what makes the caching here safe. `lib/vcs` oids are
 * sha256 over canonical JSON with explicit timestamps, and `lib/agents`
 * delta ids use a logical counter rather than wall-clock time (SPEC §4.5
 * #12), so rebuilding the repository yields byte-identical oids every time.
 * That means a request can rebuild rather than mutate shared state — which is
 * why `evaluateMerge`, whose success path writes a merge commit, is always
 * handed a throwaway repository.
 */

import {
  applyVariant,
  diffSequences,
  getLocus,
  loadLoci,
  referenceSequence,
} from '@/lib/genome';
import type { Locus, LocusGenotype, LocusVariant, Sequence } from '@/lib/genome';
import { Repo } from '@/lib/vcs';
import type { Oid } from '@/lib/vcs';
import {
  checkRunFromPipeline,
  evaluateMerge,
  introducedCommits,
  resolveSignoff,
} from '@/lib/merge-gate';
import type { CheckRun } from '@/lib/merge-gate';
import {
  isAssayPayload,
  isEditPlanPayload,
  isIntentPayload,
  isOffTargetPayload,
  isScreenPayload,
  isStructuralPayload,
  isVerdictPayload,
  pipelineAgentOrder,
  runPipeline,
} from '@/lib/agents';
import type { Delta, PipelineResult } from '@/lib/agents';
import {
  ASSAY_MODEL_LIMITATION,
  PO2_RANGE,
  SIMULATION_DEFAULTS,
} from '@/lib/cellsim';
import type { SimMetrics } from '@/lib/cellsim';

import rawLoci from '@/data/loci.json';

import {
  branchNameForGenotype,
  branchNameForVariant,
  editViewOf,
  fixed,
  locusView,
  operationWordFor,
  percent,
  requestFor,
  requireVariant,
  sequenceView,
  short,
  uncoveredVariants,
} from './derive';
import type {
  AgentStepView,
  BranchSpec,
  BranchView,
  CheckRunView,
  CommitView,
  DetailRow,
  DiffView,
  EditView,
  MergeDecisionView,
  MergeProposalView,
  RunView,
  ScreenView,
  WorkspaceView,
} from './types';

/** A sign-off is only as good as the name on it, so the name is required. */
const APPROVER_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}'’. -]{1,119}$/u;

const DEFAULT_BRANCH = 'main';
const FIXTURE_AUTHOR = 'sigmafold-fixture';

/** The role each pipeline position plays, for the run log's row subtitles. */
const AGENT_ROLES: Readonly<Record<string, string>> = Object.freeze({
  IntentAgent: 'Normalise the request into a structured intent',
  BiosafetyGateAgent: 'Screen the intent before any downstream work',
  EditPlannerAgent: 'Resolve the target locus and edit against data/loci.json',
  StructuralImpactAgent: 'Amino-acid change to annotated structural consequence',
  FunctionalAssayAgent: 'Run the simulation headless and report metrics',
  OffTargetRiskAgent: 'Flag the target against the sensitive-locus registry',
  VerifierAgent: 'Cross-check every claim against measured simulation output',
});

/** Which delta kind each agent position emits, for pairing rows to deltas. */
const AGENT_KIND: Readonly<Record<string, Delta['kind']>> = Object.freeze({
  IntentAgent: 'intent',
  BiosafetyGateAgent: 'screen',
  EditPlannerAgent: 'edit_plan',
  StructuralImpactAgent: 'structural',
  FunctionalAssayAgent: 'assay',
  OffTargetRiskAgent: 'offtarget',
  VerifierAgent: 'verdict',
});

/* ──────────────────────────── seeding the repo ─────────────────────────── */

interface SeededBranch {
  readonly name: string;
  readonly head: Oid;
  readonly origin: string;
  readonly genotypeId: string | null;
  readonly genotypeLabel: string | null;
  readonly polymerizationTendency: number | null;
  readonly sequence: Sequence;
  readonly variants: readonly LocusVariant[];
  /** Oldest first, root included. Captured at seed time. */
  readonly commitOids: readonly Oid[];
}

interface SeededRepo {
  readonly repo: Repo;
  readonly locus: Locus;
  readonly reference: Sequence;
  readonly branches: readonly SeededBranch[];
  /** commit oid → the fixture variant that commit introduces. */
  readonly editByCommit: ReadonlyMap<Oid, LocusVariant>;
  readonly checks: ReadonlyMap<string, CheckRun>;
}

function requireLocus(): Locus {
  const loci = loadLoci();
  const first = loci[0];
  if (first === undefined) {
    throw new Error('shell/model: data/loci.json contains no loci');
  }
  // Prefer the locus the safety registry calls the in-scope therapeutic case,
  // falling back to the first entry, so adding a locus cannot silently
  // re-point the shell at an unexpected one.
  return getLocus(first.gene) ?? first;
}

function writeGenotype(repo: Repo, gene: string, sequence: Sequence): Oid {
  const blob = repo.write({ kind: 'blob', sequence });
  return repo.write({ kind: 'tree', entries: { [gene]: blob } });
}

/**
 * Build the repository from the fixture.
 *
 * `main` holds the imported reference. Each genotype in the locus that applies
 * at least one variant becomes a branch, with one commit per applied variant
 * so the history shows the edits in the order the fixture states. Any curated
 * variant no genotype covers also gets its own single-commit branch, so every
 * fixture variant is reachable from the UI — that is how the synthetic silent
 * variant and the conflict case it creates reach the merge view.
 *
 * Timestamps are the commit's index within its branch, not wall-clock time, so
 * oids are reproducible across processes.
 */
function seedRepo(
  checks: ReadonlyMap<string, CheckRun>,
  overlay: readonly BranchSpec[] = [],
): SeededRepo {
  const locus = requireLocus();
  const reference = referenceSequence(locus);
  const repo = new Repo();
  const editByCommit = new Map<Oid, LocusVariant>();

  const rootTree = writeGenotype(repo, locus.gene, reference);
  const root = repo.commit({
    tree: rootTree,
    author: FIXTURE_AUTHOR,
    message: `Import ${locus.gene} ${locus.cdsReference.label}`,
    timestamp: 0,
  });

  const branches: SeededBranch[] = [
    {
      name: DEFAULT_BRANCH,
      head: root,
      origin: `data/loci.json · ${locus.gene}.cdsReference`,
      genotypeId: null,
      genotypeLabel: locus.cdsReference.label,
      polymerizationTendency: referenceTendency(locus),
      sequence: reference,
      variants: [],
      commitOids: [root],
    },
  ];

  const buildLine = (
    name: string,
    origin: string,
    genotype: LocusGenotype | null,
    variants: readonly LocusVariant[],
  ): void => {
    repo.branch(name, root);
    repo.checkout(name);
    let sequence = reference;
    let index = 1;
    const commitOids: Oid[] = [root];
    for (const variant of variants) {
      sequence = applyVariant(sequence, variant);
      const tree = writeGenotype(repo, locus.gene, sequence);
      // The check run is produced before the commit so the commit can carry
      // its `checkRunId`, which is how `lib/merge-gate` finds it later.
      const check = checks.get(checkIdFor(locus, variant));
      const oid = repo.commit({
        tree,
        author: FIXTURE_AUTHOR,
        message: variant.label,
        timestamp: index,
        edit: variant,
        ...(check === undefined ? {} : { checkRunId: check.id }),
      });
      editByCommit.set(oid, variant);
      commitOids.push(oid);
      index += 1;
    }
    branches.push({
      name,
      head: repo.head(),
      origin,
      genotypeId: genotype === null ? null : genotype.id,
      genotypeLabel: genotype === null ? null : genotype.label,
      polymerizationTendency:
        genotype === null
          ? (variants[variants.length - 1]?.structural.polymerizationTendency ?? null)
          : genotype.polymerizationTendency,
      sequence,
      variants,
      commitOids,
    });
  };

  for (const genotype of locus.genotypes) {
    if (genotype.appliedVariants.length === 0) continue;
    buildLine(
      branchNameForGenotype(genotype.id),
      `data/loci.json · genotype '${genotype.id}'`,
      genotype,
      genotype.appliedVariants.map((id) => requireVariant(locus, id)),
    );
  }

  for (const variant of uncoveredVariants(locus)) {
    buildLine(
      branchNameForVariant(locus.gene, variant.id),
      `data/loci.json · variant '${variant.id}' (no genotype applies it)`,
      null,
      [variant],
    );
  }

  // Replay user-created branches. These are real `Repo.branch()` refs with a
  // real `applyVariant` commit — the only difference from a fixture line is
  // that the instruction came from the client rather than from a genotype.
  const overlayChecks = new Map<string, CheckRun>(checks);
  for (const spec of overlay) {
    const source = branches.find((b) => b.name === spec.from);
    if (source === undefined) {
      throw new Error(
        `shell/model: cannot branch from '${spec.from}', which does not exist`,
      );
    }
    if (branches.some((b) => b.name === spec.name)) {
      throw new Error(`shell/model: branch '${spec.name}' already exists`);
    }
    const variant = requireVariant(locus, spec.variantId);

    repo.branch(spec.name, source.head);
    repo.checkout(spec.name);
    const sequence = applyVariant(source.sequence, variant);
    const tree = writeGenotype(repo, locus.gene, sequence);

    // The check has to be bound to *this* commit. A fixture branch applying
    // the same variant produces a different oid (different parents), and
    // `lib/merge-gate` verifies `check.commit === commitOid` before accepting
    // a check — so reusing the fixture's check run would read as missing and
    // fail the merge closed.
    const result = runFor(requestFor(locus, variant));
    const oid = repo.commit({
      tree,
      author: FIXTURE_AUTHOR,
      message: variant.label,
      timestamp: source.commitOids.length,
      edit: variant,
    });
    const check = checkRunFromPipeline({
      commit: oid,
      result,
      id: `${result.headId}:${oid.slice(0, 12)}`,
    });
    // Keyed by commit oid, not by check id. The fixture commits carry a
    // `checkRunId` and are found by that; this commit cannot, because its oid
    // is not known until after it is written and the id would then be part of
    // the content being hashed. `lib/merge-gate` resolves exactly that case by
    // falling back to `checks.get(commitOid)`, so the key has to be the oid —
    // keyed by id it reads as *missing*, and the gate fails closed.
    overlayChecks.set(oid, check);

    editByCommit.set(oid, variant);
    branches.push({
      name: spec.name,
      head: oid,
      origin: `created from ${spec.from} · variant '${variant.id}'`,
      genotypeId: null,
      genotypeLabel: variant.label,
      polymerizationTendency: variant.structural.polymerizationTendency,
      sequence,
      variants: [variant],
      commitOids: [...source.commitOids, oid],
    });
  }

  repo.checkout(DEFAULT_BRANCH);
  return { repo, locus, reference, branches, editByCommit, checks: overlayChecks };
}

/**
 * The reference line's polymerization tendency, read from whichever genotype
 * applies no variants rather than assumed to be zero.
 */
function referenceTendency(locus: Locus): number | null {
  const wildtype = locus.genotypes.find((g) => g.appliedVariants.length === 0);
  return wildtype === undefined ? null : wildtype.polymerizationTendency;
}

/* ───────────────────────── pipeline runs and caching ───────────────────── */

/**
 * Cache of pipeline runs keyed by request text. Safe because `runPipeline` is
 * deterministic and LLM-free (SPEC §4.3) — the same text always yields the
 * same DAG, the same delta ids and the same simulation numbers.
 */
const runCache = new Map<string, PipelineResult>();

function runFor(text: string): PipelineResult {
  const cached = runCache.get(text);
  if (cached !== undefined) return cached;
  const result = runPipeline({ text, classify: true });
  runCache.set(text, result);
  return result;
}

/** The check-run id a variant's commit will carry. */
function checkIdFor(locus: Locus, variant: LocusVariant): string {
  return runFor(requestFor(locus, variant)).headId;
}

/**
 * Every check run the fixture produces, keyed by id. Built before the repo so
 * commits can reference their check; the `commit` field is patched in once the
 * commit oids exist.
 */
function seedChecks(): ReadonlyMap<string, CheckRun> {
  const locus = requireLocus();
  const checks = new Map<string, CheckRun>();
  for (const variant of locus.variants) {
    const result = runFor(requestFor(locus, variant));
    const check = checkRunFromPipeline({ commit: '', result });
    checks.set(check.id, check);
  }
  return checks;
}

let cached: SeededRepo | null = null;

/** The fixture-only workspace, memoised. Deterministic, so caching is sound. */
function seeded(): SeededRepo {
  if (cached !== null) return cached;
  const preliminary = seedChecks();
  const built = seedRepo(preliminary);

  // Re-key each check against the commit it actually belongs to. `lib/merge-gate`
  // verifies `check.commit === commitOid` before accepting a check, so this
  // binding has to be real rather than nominal.
  const checks = new Map<string, CheckRun>();
  for (const [oid, variant] of built.editByCommit) {
    const result = runFor(requestFor(built.locus, variant));
    const check = checkRunFromPipeline({ commit: oid, result });
    checks.set(check.id, check);
  }
  cached = { ...built, checks };
  return cached;
}

/**
 * The workspace for a request, including any branches the client created.
 *
 * Always a fresh repository when an overlay is present, and never cached:
 * caching would make one client's created branches visible to another, and
 * `evaluateMerge` writes a merge commit on its success path, which a shared
 * repository would accumulate across requests. Rebuilding is cheap because
 * the expensive part — the pipeline runs — is memoised by request text in
 * `runCache`, and deterministic oids mean a replay reproduces the same
 * hashes.
 */
function build(overlay: readonly BranchSpec[] = []): SeededRepo {
  if (overlay.length === 0) return seeded();
  return seedRepo(seeded().checks, overlay);
}

/** A throwaway repository for operations that write. */
function scratch(overlay: readonly BranchSpec[] = []): SeededRepo {
  return seedRepo(seeded().checks, overlay);
}

/* ─────────────────────────── view model building ───────────────────────── */

function checkRunView(check: CheckRun): CheckRunView {
  return {
    id: check.id,
    commit: check.commit,
    status: check.status,
    requiresSignoff: check.requiresSignoff,
    signoffRole: check.signoffRole ?? null,
    signedOffBy: check.signedOffBy ?? null,
    reasons: [...check.reasons],
  };
}

function metricRows(label: string, metrics: SimMetrics | null): DetailRow[] {
  if (metrics === null) return [{ label, value: 'not measured' }];
  return [
    { label: `${label} · occlusion`, value: fixed(metrics.occlusion) },
    { label: `${label} · mean flow`, value: fixed(metrics.meanFlow) },
    { label: `${label} · sickled fraction`, value: percent(metrics.sickledFraction) },
  ];
}

function stepFor(position: number, agent: string, deltas: readonly Delta[]): AgentStepView {
  const kind = AGENT_KIND[agent];
  const delta = deltas.find((d) => d.author === agent);
  const role = AGENT_ROLES[agent] ?? '';
  const base = {
    position,
    agent,
    role,
    kind: kind ?? null,
  };

  if (delta === undefined) {
    return {
      ...base,
      deltaId: null,
      createdAt: null,
      outcome: 'not-run',
      headline: 'Did not run — the gate terminated the pipeline.',
      detail: [],
    };
  }

  const common = {
    ...base,
    kind: delta.kind,
    deltaId: delta.id,
    createdAt: delta.createdAt,
  };
  const payload: unknown = delta.payload;

  if (isScreenPayload(payload)) {
    const outcome =
      payload.verdict === 'block'
        ? 'blocked'
        : payload.verdict === 'escalate'
          ? 'escalated'
          : 'passed';
    const detail: DetailRow[] = [
      { label: 'Category', value: payload.category },
      { label: 'Verdict', value: payload.verdict },
      { label: 'Reason', value: payload.reason },
      { label: 'Request digest', value: payload.requestDigest },
      { label: 'Input retained', value: payload.redacted ? 'no — redacted' : 'yes' },
    ];
    // Withheld for a refused verdict: the flagged symbols describe what was
    // asked, and SPEC §7.3 allows only the category and a generic reason.
    if (!payload.redacted && payload.flaggedGenes.length > 0) {
      detail.push({ label: 'Flagged loci', value: payload.flaggedGenes.join(', ') });
    }
    if (payload.signoffRole !== undefined) {
      detail.push({ label: 'Sign-off role', value: payload.signoffRole });
    }
    return { ...common, outcome, headline: payload.category, detail };
  }

  if (isIntentPayload(payload)) {
    return {
      ...common,
      outcome: 'passed',
      headline: `${payload.operation} · ${payload.targets.length === 0 ? 'no target resolved' : payload.targets.join(', ')}`,
      detail: [
        { label: 'Operation', value: payload.operation },
        { label: 'Targets', value: payload.targets.join(', ') || 'none' },
        { label: 'Variant hint', value: payload.variantHint ?? 'none' },
      ],
    };
  }

  if (isEditPlanPayload(payload)) {
    const detail: DetailRow[] = [
      { label: 'Resolved', value: payload.resolved ? 'yes' : 'no' },
      { label: 'Note', value: payload.note },
    ];
    if (payload.gene !== null) detail.push({ label: 'Gene', value: payload.gene });
    if (payload.variantId !== null) {
      detail.push({ label: 'Variant', value: payload.variantId });
    }
    if (payload.variantLabel !== null) {
      detail.push({ label: 'Variant label', value: payload.variantLabel });
    }
    if (payload.genotypeLabel !== null) {
      detail.push({ label: 'Genotype', value: payload.genotypeLabel });
    }
    if (payload.codonIndex !== null) {
      detail.push({ label: 'Codon (CDS)', value: String(payload.codonIndex) });
    }
    if (payload.refCodon !== null && payload.altCodon !== null) {
      detail.push({
        label: 'Codon change',
        value: `${payload.refCodon} → ${payload.altCodon}`,
        sequence: true,
      });
    }
    if (payload.polymerizationTendency !== null) {
      detail.push({
        label: 'Polymerization tendency',
        value: fixed(payload.polymerizationTendency, 2),
      });
    }
    return {
      ...common,
      outcome: payload.resolved ? 'passed' : 'blocked',
      headline: payload.resolved
        ? `${payload.gene ?? '—'} · ${payload.variantLabel ?? payload.variantId ?? '—'}`
        : 'No curated locus matched',
      detail,
    };
  }

  if (isStructuralPayload(payload)) {
    const detail: DetailRow[] = [
      { label: 'From fixture', value: payload.sourcedFromFixture ? 'yes' : 'no' },
      { label: 'Summary', value: payload.summary },
      { label: 'Consequence', value: payload.consequence },
      { label: 'Limitation', value: payload.limitation },
    ];
    if (payload.refAa !== null && payload.altAa !== null) {
      detail.unshift({
        label: 'Residue change',
        value: `${payload.refAa} → ${payload.altAa}`,
        sequence: true,
      });
    }
    if (payload.refAaName !== null && payload.altAaName !== null) {
      detail.splice(1, 0, {
        label: 'Residue names',
        value: `${payload.refAaName} → ${payload.altAaName}`,
      });
    }
    if (payload.confidence !== null) {
      detail.push({ label: 'Confidence', value: payload.confidence });
    }
    return {
      ...common,
      outcome: 'passed',
      headline:
        payload.refAa !== null && payload.altAa !== null
          ? `${payload.refAa} → ${payload.altAa}`
          : payload.summary,
      detail,
    };
  }

  if (isAssayPayload(payload)) {
    const detail: DetailRow[] = [
      { label: 'Ran', value: payload.ran ? 'yes' : 'no' },
      { label: 'Assessment', value: payload.assessment.replace(/_/g, ' ') },
    ];
    if (payload.params !== null) {
      detail.push(
        { label: 'pO₂', value: `${payload.params.pO2} ${PO2_RANGE.unit}` },
        { label: 'Seed', value: String(payload.params.seed) },
        { label: 'Cells', value: String(payload.params.cellCount) },
      );
    }
    detail.push(...metricRows('Measured', payload.metrics));
    detail.push({ label: 'Limitation', value: payload.limitation });
    return {
      ...common,
      outcome: 'passed',
      headline: payload.assessment.replace(/_/g, ' '),
      detail,
    };
  }

  if (isOffTargetPayload(payload)) {
    const detail: DetailRow[] = [
      { label: 'Method', value: payload.method.replace(/-/g, ' ') },
      { label: 'Targets', value: payload.targets.join(', ') || 'none' },
    ];
    for (const hit of payload.hits) {
      detail.push({
        label: hit.gene,
        value: `${hit.classification.replace(/_/g, ' ')} — ${hit.note}`,
      });
    }
    return {
      ...common,
      outcome: 'passed',
      headline:
        payload.hits.length === 0
          ? 'No registry hit'
          : `${payload.hits.length} registry hit${payload.hits.length === 1 ? '' : 's'}`,
      detail,
    };
  }

  if (isVerdictPayload(payload)) {
    const detail: DetailRow[] = [
      { label: 'Passed', value: payload.passed ? 'yes' : 'no' },
      { label: 'Merge blocked', value: payload.mergeBlocked ? 'yes' : 'no' },
      {
        label: 'Disagreed with assay',
        value: payload.disagreedWithAssay ? 'yes' : 'no',
      },
      {
        label: 'Disagreed with structural',
        value: payload.disagreedWithStructural ? 'yes' : 'no',
      },
    ];
    for (const reason of payload.reasons) {
      detail.push({ label: 'Reason', value: reason });
    }
    detail.push(
      ...metricRows('At requested pO₂', payload.measured.highPO2),
      ...metricRows(`At pO₂ ${PO2_RANGE.min}`, payload.measured.lowPO2),
      ...metricRows('Reference, low pO₂', payload.measured.referenceLowPO2),
    );
    return {
      ...common,
      outcome: payload.passed ? 'passed' : 'blocked',
      headline: payload.passed ? 'Verified' : 'Failed verification',
      detail,
    };
  }

  return {
    ...common,
    outcome: 'passed',
    headline: delta.subject,
    detail: [{ label: 'Subject', value: delta.subject }],
  };
}

function runView(args: {
  readonly branch: string;
  readonly commit: string;
  readonly request: string;
  readonly result: PipelineResult;
  readonly check: CheckRun;
}): RunView {
  const deltas = args.result.dag.all();
  const steps = pipelineAgentOrder().map((agent, i) => stepFor(i + 1, agent, deltas));

  const screenDelta = deltas.find((d) => d.kind === 'screen');
  const digest =
    screenDelta !== undefined && isScreenPayload(screenDelta.payload)
      ? screenDelta.payload.requestDigest
      : '';

  const verdictDelta = deltas.find((d) => d.kind === 'verdict');
  const verdict =
    verdictDelta !== undefined && isVerdictPayload(verdictDelta.payload)
      ? verdictDelta.payload
      : null;

  const assayDelta = deltas.find((d) => d.kind === 'assay');
  const assayLimitation =
    assayDelta !== undefined && isAssayPayload(assayDelta.payload)
      ? assayDelta.payload.limitation
      : ASSAY_MODEL_LIMITATION;

  return {
    branch: args.branch,
    commit: args.commit,
    request: args.request,
    requestDigest: digest,
    blocked: args.result.blocked,
    escalated: args.result.escalated,
    passed: args.result.passed,
    mergeAllowed: args.result.mergeAllowed,
    requiresSignoff: args.result.requiresSignoff,
    signoffRole: args.result.signoffRole ?? null,
    deltaCount: deltas.length,
    headId: args.result.headId,
    steps,
    measured:
      verdict === null
        ? { highPO2: null, lowPO2: null, referenceLowPO2: null }
        : {
            highPO2: verdict.measured.highPO2,
            lowPO2: verdict.measured.lowPO2,
            referenceLowPO2: verdict.measured.referenceLowPO2,
          },
    check: checkRunView(args.check),
    disagreedWithAssay: verdict !== null && verdict.disagreedWithAssay,
    disagreedWithStructural: verdict !== null && verdict.disagreedWithStructural,
    assayLimitation,
  };
}

/**
 * Commits on a branch, newest first.
 *
 * `Repo.log` returns commit *objects* rather than their oids, and the shell
 * needs the oids to show short hashes and to key check runs. Rather than
 * re-hashing to recover them, the oids are captured at seed time — see
 * `SeededBranch.commitOids` — which keeps this a lookup.
 */
function commitViews(
  repo: Repo,
  branch: SeededBranch,
  editByCommit: ReadonlyMap<Oid, LocusVariant>,
  locus: Locus,
): CommitView[] {
  const views: CommitView[] = [];
  for (const oid of [...branch.commitOids].reverse()) {
    const obj = repo.read(oid);
    if (obj.kind !== 'commit') {
      throw new Error(`shell/model: expected commit at ${oid}, got ${obj.kind}`);
    }
    const variant = editByCommit.get(oid);
    views.push({
      oid,
      short: short(oid),
      author: obj.author,
      message: obj.message,
      timestamp: obj.timestamp,
      parents: [...obj.parents],
      edit: variant === undefined ? null : editViewOf(locus, variant),
    });
  }
  return views;
}

function branchView(seed: SeededRepo, branch: SeededBranch): BranchView {
  const tipVariant = branch.variants[branch.variants.length - 1] ?? null;
  const tipEdit: EditView | null =
    tipVariant === null ? null : editViewOf(seed.locus, tipVariant);

  // A line that proposes no edit gets no run. See `BranchView.run`.
  let request: string | null = null;
  let run: RunView | null = null;
  if (tipVariant !== null) {
    request = requestFor(seed.locus, tipVariant);
    const result = runFor(request);
    // Find the check bound to *this* head rather than by request text: a
    // created branch applying the same variant has the same request but a
    // different commit, and a check whose `commit` does not match is not this
    // branch's check.
    let bound: CheckRun | undefined;
    for (const candidate of seed.checks.values()) {
      if (candidate.commit === branch.head) {
        bound = candidate;
        break;
      }
    }
    const check = bound ?? checkRunFromPipeline({ commit: branch.head, result });
    run = runView({
      branch: branch.name,
      commit: branch.head,
      request,
      result,
      check,
    });
  }

  return {
    name: branch.name,
    head: branch.head,
    shortHead: short(branch.head),
    commitCount: branch.commitOids.length,
    isDefault: branch.name === DEFAULT_BRANCH,
    origin: branch.origin,
    genotypeId: branch.genotypeId,
    genotypeLabel: branch.genotypeLabel,
    polymerizationTendency: branch.polymerizationTendency,
    tipEdit,
    sequence: sequenceView(branch.sequence),
    request,
    commits: commitViews(seed.repo, branch, seed.editByCommit, seed.locus),
    run,
  };
}

/* ───────────────────────────── public surface ──────────────────────────── */

export function buildWorkspace(overlay: readonly BranchSpec[] = []): WorkspaceView {
  const seed = build(overlay);
  return {
    locus: locusView(seed.locus),
    branches: seed.branches.map((branch) => branchView(seed, branch)),
    defaultBranch: DEFAULT_BRANCH,
    variants: seed.locus.variants.map((v) => editViewOf(seed.locus, v)),
    exampleRequest: exampleRequestFor(seed.locus),
    agentOrder: [...pipelineAgentOrder()],
    simulation: {
      seed: SIMULATION_DEFAULTS.seed,
      cellCount: SIMULATION_DEFAULTS.cellCount,
      pO2: SIMULATION_DEFAULTS.pO2,
      capillaryConstriction: SIMULATION_DEFAULTS.capillaryConstriction,
      pO2Min: PO2_RANGE.min,
      pO2Max: PO2_RANGE.max,
      assayLimitation: ASSAY_MODEL_LIMITATION,
    },
    fixtureDisclaimer: rawLoci._disclaimer,
  };
}

/**
 * An example request for the console, derived rather than written.
 *
 * Prefers the repair variant, since that is the in-scope therapeutic case the
 * gate allows, and falls back to the first curated variant so a fixture
 * without a repair still produces a real example.
 */
function exampleRequestFor(locus: Locus): string {
  const repair = locus.variants.find(
    (v) => operationWordFor(locus, v) === 'Repair',
  );
  const variant = repair ?? locus.variants[0];
  if (variant === undefined) {
    throw new Error('shell/model: locus has no curated variant to build an example from');
  }
  return requestFor(locus, variant);
}

/** The diff of a branch's genotype against the imported reference. */
export function buildDiff(
  branchName: string,
  overlay: readonly BranchSpec[] = [],
): DiffView {
  const seed = build(overlay);
  const branch = seed.branches.find((b) => b.name === branchName);
  if (branch === undefined) {
    throw new Error(`shell/model: unknown branch '${branchName}'`);
  }
  const rows = diffSequences(seed.reference, branch.sequence);
  const changedRows = rows
    .filter((row) => row.status !== 'same')
    .map((row) => row.codonIndex);
  return {
    ref: sequenceView(seed.reference),
    alt: sequenceView(branch.sequence),
    rows,
    changedRows,
    focusRow: changedRows[0] ?? null,
    coordinateNote:
      'Row numbers are 1-based alignment rows, not CDS coordinates. For a ' +
      'substitution the two coincide; after an insertion or deletion the two ' +
      "sequences' biological numbering diverges and one row cannot name a " +
      'position in both systems (SPEC §4.5 #2).',
  };
}

export function buildMergeProposal(args: {
  readonly into: string;
  readonly incoming: string;
  readonly signedOffBy?: readonly string[];
  readonly overlay?: readonly BranchSpec[];
}): MergeProposalView {
  const overlay = args.overlay ?? [];
  const seed = build(overlay);
  const fresh = scratch(overlay);
  const into = fresh.branches.find((b) => b.name === args.into);
  const incoming = fresh.branches.find((b) => b.name === args.incoming);
  if (into === undefined || incoming === undefined) {
    throw new Error(
      `shell/model: unknown branch in merge proposal '${args.incoming}' → '${args.into}'`,
    );
  }

  // A signature is a person's name and is shape-checked before it can reach a
  // check or the view. Without this the box accepts arbitrary text, and
  // someone refused by the gate could paste their refused request into it and
  // have it rendered straight back (SPEC §7.3).
  const signatures = (args.signedOffBy ?? [])
    .map((candidate) => candidate.trim().slice(0, 120))
    .filter((candidate) => APPROVER_PATTERN.test(candidate));

  const checks = new Map<string, CheckRun>();
  for (const [id, check] of seed.checks) {
    const first = signatures[0];
    if (first === undefined) {
      checks.set(id, check);
      continue;
    }
    // `resolveSignoff` is the single authority: it derives the role from the
    // policy's verdict and refuses a blocked run, a run that is not awaiting a
    // sign-off, and an unnamed actor. A signature therefore cannot widen what
    // the policy allows (SPEC §7.5).
    const resolved = resolveSignoff(check, first);
    checks.set(id, resolved.ok ? resolved.check : check);
  }

  const base = fresh.repo.mergeBase(into.head, incoming.head);
  const introduced = introducedCommits(fresh.repo, into.head, incoming.head);
  const decision = evaluateMerge({
    repo: fresh.repo,
    ours: into.head,
    theirs: incoming.head,
    checks,
  });

  return {
    into: args.into,
    incoming: args.incoming,
    mergeBase: base,
    mergeBaseShort: base === null ? null : short(base),
    introduced: introduced.map((oid) => {
      const obj = fresh.repo.read(oid);
      if (obj.kind !== 'commit') {
        throw new Error(`shell/model: expected commit at ${oid}`);
      }
      const variant = fresh.editByCommit.get(oid);
      return {
        oid,
        short: short(oid),
        author: obj.author,
        message: obj.message,
        timestamp: obj.timestamp,
        parents: [...obj.parents],
        edit: variant === undefined ? null : editViewOf(fresh.locus, variant),
      };
    }),
    decision: mergeDecisionView(decision),
    signedOff: signatures,
  };
}

function mergeDecisionView(
  decision: ReturnType<typeof evaluateMerge>,
): MergeDecisionView {
  if (decision.allowed) {
    return { kind: 'allowed', oid: decision.oid, short: short(decision.oid) };
  }
  switch (decision.kind) {
    case 'content-conflict':
      return {
        kind: 'content-conflict',
        conflicts: decision.conflicts.map((c) => ({
          gene: c.gene,
          base: c.base,
          ours: c.ours,
          theirs: c.theirs,
        })),
      };
    case 'check-failed':
      return {
        kind: 'check-failed',
        reasons: [...decision.reasons],
        blocking: decision.blocking.map(checkRunView),
      };
    case 'awaiting-signoff':
      return {
        kind: 'awaiting-signoff',
        signoffRole: decision.signoffRole,
        blocking: decision.blocking.map(checkRunView),
      };
    case 'check-missing':
      return { kind: 'check-missing', commits: [...decision.commits] };
  }
}

/**
 * Screen free text from the red-team console, and run the full pipeline when
 * the gate permits it.
 *
 * SPEC §7.3 is binding here: for any `block`-class verdict the request text is
 * never returned. `echo` is nulled on this side of the boundary, so redacted
 * input cannot reach the client at all — not as a prop, not in a payload, not
 * in a log line. The gate's own `requestDigest` is what makes the entry
 * auditable without retaining what was typed.
 */
export function screenConsoleRequest(args: {
  readonly text: string;
  readonly seq: number;
}): ScreenView {
  // The gate is read from the pipeline's own position-2 screen rather than
  // screened separately here. Two reasons, both load-bearing:
  //
  //  - `screen()` decides THERAPEUTIC_SOMATIC vs OUT_OF_SCOPE from the gene
  //    symbols the IntentAgent resolved. Calling it without those targets
  //    makes every legitimate request OUT_OF_SCOPE, which is block-class — a
  //    second, *different* gate that silently refuses valid input.
  //  - SPEC §7.4 wants one structural gate, not a second evaluation beside it.
  //
  // `runPipeline` terminates at the gate on a `block` verdict, so no
  // downstream agent runs for a refused request (SPEC §4.5 #9).
  const result = runPipeline({ text: args.text, classify: true });
  const screenDelta = result.dag.all().find((d) => d.kind === 'screen');
  if (screenDelta === undefined || !isScreenPayload(screenDelta.payload)) {
    throw new Error('shell/model: pipeline did not emit a biosafety screen');
  }
  const verdict = screenDelta.payload;

  const base = {
    category: verdict.category,
    verdict: verdict.verdict,
    reason: verdict.reason,
    requiresSignoff: verdict.requiresSignoff,
    signoffRole: verdict.signoffRole ?? null,
    flaggedGenes: verdict.redacted ? [] : [...verdict.flaggedGenes],
    requestDigest: verdict.requestDigest,
    seq: args.seq,
  };

  // A refused request stops here. The DAG is discarded rather than projected,
  // so neither the text nor anything derived from it beyond the policy's own
  // digest crosses to the client (SPEC §7.3).
  if (verdict.redacted) {
    return { ...base, redacted: true, echo: null, run: null };
  }

  const check = checkRunFromPipeline({ commit: '', result });
  return {
    ...base,
    redacted: false,
    echo: args.text,
    run: runView({
      branch: 'console',
      commit: '',
      request: args.text,
      result,
      check,
    }),
  };
}
