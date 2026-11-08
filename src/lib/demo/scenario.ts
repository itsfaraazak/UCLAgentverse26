/**
 * The worked example, built out of the real modules.
 *
 * SERVER ONLY — `lib/vcs` and `lib/safety` both use `node:crypto`. Call this
 * from a Server Component or a Server Action, never from a Client Component.
 *
 * Nothing on screen is a hardcoded node list: this builds an actual `Repo`,
 * commits real genotype trees into it, runs the real seven-agent pipeline per
 * proposal, performs real three-way merges, and lays the resulting ancestry
 * out with `lib/graph/layout`. Replaying with the same inputs gives byte-equal
 * oids, so the graph is stable across requests.
 *
 * Safety (SPEC §7): request texts live in this module as the demo's *inputs*.
 * They are passed to `screen()` and are never written into a commit message,
 * a delta payload or any view type — `view.ts` has no field that could carry
 * them. A refused proposal becomes a commit whose message names the policy
 * category only.
 */

import { applyVariant, diffSequences, translate, type DiffRow, type Variant } from '@/lib/genome';
import { Repo, type Commit, type MergeResult, type Oid } from '@/lib/vcs';
import { runPipeline as runRealPipeline, type Delta } from '@/lib/agents';
import { CHALLENGE_STEPS, SIMULATION_NOTE, type SimMetrics } from '@/lib/cellsim';
import {
  checkRunFromPipeline,
  resolveSignoff as resolvePolicySignoff,
  type CheckRun,
} from '@/lib/merge-gate';
import { PIPELINE_STEPS, runView as projectRun, type RunView as RunProjection } from '@/lib/run-view';
import { digestRequest, type ScreenResult } from '@/lib/safety/policy';
import {
  LOCI_DISCLAIMER,
  SIMULATION,
  getVariant,
  requireLocus,
  requireVariant,
  type Locus,
  type LocusVariant,
} from '@/lib/fixtures/loci';
import { describeGraph, layoutGraph, type LayoutCommit } from '@/lib/graph/layout';
import type {
  BranchView,
  CheckStatusView,
  CommitView,
  ConflictView,
  DeltaField,
  DeltaView,
  DiffView,
  EditView,
  GenotypeView,
  MergeOutcome,
  MergeRequest,
  PolicyVerdict,
  PolicyView,
  RunView,
  RunVerdictView,
  ScenarioView,
  SignoffRequest,
} from './view';

/** Compile-time check that the view's unions still match the policy's. */
const _verdictsAlign: PolicyVerdict = 'allow' satisfies ScreenResult['verdict'];
void _verdictsAlign;

const GENE = 'HBB';
const MAIN = 'main';
const AUTHOR = 'r.okafor@sigmafold.example';

/** Fixed clock: 2 Feb 2026, 09:00 UTC. Keeps oids stable across runs. */
const BASE_TIME = Date.UTC(2026, 1, 2, 9, 0, 0);

/**
 * Stand-in commit for a console run. A console run proposes nothing, so its
 * check is never looked up by the merge gate; this keeps the type honest
 * instead of making the field optional and letting a real run omit it.
 */
const CONSOLE_COMMIT = 'console';
const HOUR = 3_600_000;

export function shortOid(oid: Oid): string {
  return oid.slice(0, 12);
}

interface Proposal {
  /** Branch to create for this proposal; `main` commits onto the mainline. */
  readonly branch: string;
  /** Branch to fork from. */
  readonly forkFrom: string;
  readonly message: string;
  /** The demo's input to the gate. Never stored or rendered. */
  readonly requestText: string;
  readonly targets: readonly string[];
  /** Curated (or synthetic) variant this proposal would apply, if any. */
  readonly variantId: string | null;
  readonly hoursAfterBase: number;
  readonly runId: string;
}

/**
 * The demo history. Ordered so that the mainline's merge is the newest commit,
 * which keeps `main` in lane 0 of the rendered graph.
 */
const PROPOSALS: readonly Proposal[] = Object.freeze([
  {
    branch: MAIN,
    forkFrom: MAIN,
    message: 'Record patient-derived sickle allele (HbS) as the working baseline',
    requestText:
      'Record the patient-derived HBB beta-globin allele as the working baseline ' +
      'so that a proposed repair can be diffed against it.',
    targets: [GENE],
    variantId: 'HBB_HbS',
    hoursAfterBase: 2,
    runId: 'run-baseline-hbs',
  },
  // A two-commit review branch: it repairs the codon and then adds a marker on
  // top. Both commits pass their checks, and because its genotype tree ends up
  // different from the mainline's it is the branch that produces a genuine
  // three-way merge CONFLICT rather than being stopped by a check.
  {
    branch: 'review/marker-on-repair',
    forkFrom: MAIN,
    message: 'Restore the reference codon at HBB codon 7 (review branch)',
    requestText:
      'Restore the reference codon at HBB codon 7, in order to correct the ' +
      'sickle substitution in somatic cells.',
    targets: [GENE],
    variantId: 'HBB_repair',
    hoursAfterBase: 6,
    runId: 'run-review-repair',
  },
  {
    branch: 'review/marker-on-repair',
    forkFrom: 'review/marker-on-repair',
    message: 'Add a synonymous marker codon at HBB codon 5 on top of the repair',
    requestText:
      'Add a synonymous marker codon at HBB codon 5 to label the repaired ' +
      'allele for downstream somatic analysis.',
    targets: [GENE],
    variantId: 'HBB_silent_demo',
    hoursAfterBase: 8,
    runId: 'run-review-marker',
  },
  {
    branch: 'experiment/silent-marker',
    forkFrom: MAIN,
    message: 'Add a synonymous marker codon at HBB codon 5',
    requestText:
      'Add a synonymous marker codon at HBB codon 5 to label the edited allele ' +
      'for downstream somatic analysis.',
    targets: [GENE],
    variantId: 'HBB_silent_demo',
    hoursAfterBase: 10,
    runId: 'run-silent-marker',
  },
  {
    branch: 'escalate/germline-inherited-repair',
    forkFrom: MAIN,
    message: 'Propose applying the codon-7 repair heritably',
    requestText:
      'Apply the HBB codon 7 repair in embryos so the correction is passed to ' +
      'future generations.',
    targets: [GENE],
    variantId: 'HBB_repair',
    hoursAfterBase: 14,
    runId: 'run-germline-escalation',
  },
  {
    branch: 'refused/tp53-disruption',
    forkFrom: MAIN,
    message: 'Refused proposal — no edit was planned',
    requestText:
      'Disrupt TP53 in a somatic cell line to study proliferation dynamics.',
    targets: ['TP53'],
    variantId: null,
    hoursAfterBase: 18,
    runId: 'run-tp53-refused',
  },
  {
    branch: 'fix/hbb-codon7',
    forkFrom: MAIN,
    message: 'Restore the reference codon at HBB codon 7',
    requestText:
      'Restore the reference codon at HBB codon 7 to correct the sickle ' +
      'substitution in somatic cells.',
    targets: [GENE],
    variantId: 'HBB_repair',
    hoursAfterBase: 22,
    runId: 'run-fix-codon7',
  },
]);

/** The merge the history ships with, so the graph has a real merge commit. */
const SEEDED_MERGE: MergeRequest = Object.freeze({ into: MAIN, from: 'fix/hbb-codon7' });

interface BuiltCommit {
  readonly oid: Oid;
  readonly commit: Commit;
  readonly bases: string;
  readonly edit: LocusVariant | null;
  readonly run: PipelineRun | null;
  readonly genotype: GenotypeView;
}

export interface ScenarioInput {
  readonly appliedMerges?: readonly MergeRequest[];
  readonly signoffs?: readonly SignoffRequest[];
}

export interface Scenario {
  readonly view: ScenarioView;
  /** Server-side only: used by the merge action to resolve branch tips. */
  readonly repo: Repo;
  readonly runByBranch: ReadonlyMap<string, PipelineRun>;
  readonly tipOf: ReadonlyMap<string, Oid>;
}

/**
 * Polymerization tendency for an arbitrary genotype sequence.
 *
 * Two rules, in order:
 *  1. An exact base-for-base match with a curated genotype takes that
 *     genotype's annotated value. This is the authoritative case.
 *  2. Otherwise, match on the translated protein and take the **highest**
 *     tendency among the curated genotypes that produce the same protein —
 *     the conservative reading, since a synonymous change cannot be assumed
 *     to have made a pathogenic allele safe.
 *
 * Returns null when nothing matches, so the caller fails loudly rather than
 * reporting a number it cannot justify.
 */
export function tendencyForSequence(
  locus: Locus,
  bases: string,
): { tendency: number; genotypeId: string | null; basis: string } | null {
  const reference = { bases: locus.cdsReference.bases, label: locus.cdsReference.label };
  const curated = locus.genotypes.map((genotype) => {
    let seq = reference;
    for (const id of genotype.appliedVariants) {
      seq = applyVariant(seq, requireVariant(locus, id));
    }
    return { genotype, bases: seq.bases, protein: translate(seq.bases) };
  });

  const worstOf = <T extends { genotype: { polymerizationTendency: number } }>(
    entries: readonly T[],
  ): T =>
    entries.reduce((a, b) =>
      b.genotype.polymerizationTendency > a.genotype.polymerizationTendency ? b : a,
    );

  const exact = curated.filter((entry) => entry.bases === bases);
  if (exact.length > 0) {
    const worst = worstOf(exact);
    // A perfect repair restores the reference bases, so more than one curated
    // genotype can share a sequence (data/loci.json annotates "HbA / HbA" at
    // 0.00 and "Post-repair" at 0.05 for what is the same sequence). Identical
    // sequences must predict identically, so the highest annotated value is
    // taken and the ambiguity is reported rather than silently resolved.
    const names = exact.map((entry) => `"${entry.genotype.label}"`).join(' and ');
    return {
      tendency: worst.genotype.polymerizationTendency,
      genotypeId: worst.genotype.id,
      basis:
        exact.length === 1
          ? `Exact sequence match with the curated ${names} genotype.`
          : `Exact sequence match with ${exact.length} curated genotypes (${names}), ` +
            `which annotate the same sequence differently. The highest annotated ` +
            `tendency is taken.`,
    };
  }

  const protein = translate(bases);
  const sameProtein = curated.filter((entry) => entry.protein === protein);
  if (sameProtein.length === 0) return null;

  const worst = worstOf(sameProtein);
  return {
    tendency: worst.genotype.polymerizationTendency,
    genotypeId: worst.genotype.id,
    basis:
      `No curated genotype has these exact bases. The translated protein matches ` +
      `"${worst.genotype.label}", and among the curated genotypes with this protein ` +
      `the highest annotated tendency is taken.`,
  };
}

function genotypeView(locus: Locus, bases: string, label: string): GenotypeView {
  const resolved = tendencyForSequence(locus, bases);
  if (resolved === null) {
    throw new Error(
      `no curated genotype matches the protein produced by this sequence on ${locus.gene}`,
    );
  }
  return {
    label,
    bases,
    protein: translate(bases),
    polymerizationTendency: resolved.tendency,
    matchedGenotypeId: resolved.genotypeId,
    tendencyBasis: resolved.basis,
  };
}

function fieldsOf(delta: Delta): DeltaField[] {
  const payload = delta.payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }
  const out: DeltaField[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    out.push({ label: humanise(key), value: stringify(value) });
  }
  return out;
}

function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.length === 0 ? 'none' : value.map(stringify).join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${humanise(k)} ${stringify(v)}`)
      .join('; ');
  }
  return String(value);
}

function policyView(screen: ScreenResult | RunProjection['screen']): PolicyView {
  return {
    category: screen.category,
    verdict: screen.verdict,
    reason: screen.reason,
    requiresSignoff: screen.requiresSignoff,
    signoffRole: screen.signoffRole ?? null,
    // Dropped for a refused verdict: the flagged symbols describe the request
    // (SPEC §7.3). `run-view` applies the same guard.
    flaggedGenes: screen.redacted ? [] : [...screen.flaggedGenes],
    requestDigest: screen.requestDigest,
    redacted: screen.redacted,
  };
}

/**
 * Kinds whose payload describes the request rather than a derived result.
 * `intent` carries the parsed targets and operation, `screen` the flagged
 * loci; for a refusal those describe what was asked, and SPEC §7.3 permits
 * only the category and a generic reason.
 */
const REQUEST_SHAPED_KINDS: readonly Delta['kind'][] = ['intent', 'screen'];

function deltaViews(deltas: readonly Delta[], redacted: boolean): DeltaView[] {
  return deltas.map((delta) => ({
    id: delta.id,
    kind: delta.kind,
    author: delta.author,
    createdAt: delta.createdAt,
    parents: [...delta.parents],
    // The trail's shape stays visible on a refusal; its request-shaped
    // payloads do not. `policyView` drops flaggedGenes for the same reason,
    // and dumping the fields here put them straight back.
    fields:
      redacted && REQUEST_SHAPED_KINDS.includes(delta.kind)
        ? [{ label: 'Payload', value: 'withheld — this request was refused and is not retained' }]
        : fieldsOf(delta),
  }));
}

/**
 * One proposal's run, as this scenario stores it.
 *
 * This is the variant's own view layer over `lib/agents`, not a second
 * pipeline: `project` holds the shared projection from `lib/run-view` and
 * every field below is read off it. The scenario needs a couple of things the
 * shared projection does not carry — the commit-message category for a
 * refusal, and the planned variant id — so it keeps them beside it.
 */
interface PipelineRun {
  readonly id: string;
  readonly project: RunProjection;
  readonly verdict: RunVerdictView;
  readonly screen: RunProjection['screen'];
  readonly deltas: readonly Delta[];
  readonly metrics: SimMetrics | null;
  readonly plannedVariantId: string | null;
  readonly limitation: string | null;
  /** The gate check for this run, as `lib/merge-gate` evaluates it. */
  readonly check: CheckRun;
}

/** A recorded human sign-off. There is deliberately no client-settable role. */
interface Signoff {
  readonly runId: string;
  readonly role: string;
  readonly by: string;
  readonly at: number;
}

/** `lib/run-view`'s step statuses, in this view's shorter vocabulary. */
function checkStatusView(status: RunProjection['steps'][number]['status']): CheckStatusView {
  switch (status) {
    case 'passed':
      return 'pass';
    case 'failed':
      return 'fail';
    case 'blocked':
      return 'blocked';
    case 'escalated':
      return 'escalated';
    case 'warning':
      return 'pass';
    case 'not-run':
      return 'skipped';
  }
}

function runVerdictView(conclusion: RunProjection['conclusion']): RunVerdictView {
  switch (conclusion) {
    case 'passed':
      return 'pass';
    case 'failed':
      return 'fail';
    case 'blocked':
      return 'blocked';
    case 'escalated':
      return 'escalated';
  }
}

/**
 * Run the real seven-agent pipeline for a proposal and store the result.
 *
 * `commit` is the oid the resulting check is attributed to. It is the commit
 * the gate will look the check up by, so a check recorded against one commit
 * cannot clear a merge of another.
 */
function runProposalPipeline(args: {
  readonly id: string;
  readonly requestText: string;
  readonly commit: Oid;
  readonly plannedVariantId: string | null;
}): PipelineRun {
  const result = runRealPipeline({ text: args.requestText, assaySteps: CHALLENGE_STEPS });
  const project = projectRun(result);
  const check = checkRunFromPipeline({ commit: args.commit, result, id: args.id });
  // The fixture's own statement about these parameters, not a paraphrase, and
  // only when an assay actually ran: a blocked run produces no numbers, so it
  // has no model limits to disclose either.
  const assayStep = project.steps.find((step) => step.kind === 'assay');
  const assayRan = assayStep !== undefined && assayStep.status !== 'not-run';
  const limitation = assayRan ? SIMULATION_NOTE : null;
  return {
    id: args.id,
    project,
    verdict: runVerdictView(project.conclusion),
    screen: project.screen,
    deltas: result.dag.all(),
    metrics: project.measured?.lowPO2 ?? null,
    plannedVariantId: project.blocked ? null : args.plannedVariantId,
    limitation,
    check,
  };
}

/**
 * Is this run mergeable, and if not, why?
 *
 * The decision is the shared one: a refusal or a failing verifier is not
 * mergeable at all, and an escalation is mergeable only once a sign-off has
 * been resolved through the policy (SPEC §7.4, §7.5).
 */
function isMergeable(
  run: PipelineRun,
  signoffs: readonly Signoff[],
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const signed = signoffs.some((s) => s.runId === run.id);
  switch (run.verdict) {
    case 'blocked':
      return {
        ok: false,
        reason:
          `Refused at the biosafety gate (${run.screen.category}). ` +
          'A refusal cannot be signed off or merged.',
      };
    case 'fail':
      return {
        ok: false,
        reason:
          run.project.steps[6]?.summary ??
          'The verifier did not accept this edit, so it cannot be merged.',
      };
    case 'escalated':
      return signed
        ? { ok: true }
        : {
            ok: false,
            reason:
              `Escalated by policy and held for named sign-off from ` +
              `${run.screen.signoffRole ?? 'a human reviewer'}. Nothing auto-approves an escalation.`,
          };
    case 'pass':
      return { ok: true };
  }
}

function runView(run: PipelineRun, signoff: Signoff | undefined): RunView {
  const gate = isMergeable(run, signoff === undefined ? [] : [signoff]);
  const deltas = deltaViews(run.deltas, run.screen.redacted);
  return {
    id: run.id,
    verdict: run.verdict,
    checks: run.project.steps.map((step) => ({
      id: `${run.id}:${step.step}`,
      step: step.step,
      agent: step.agent,
      role: PIPELINE_STEPS[step.step - 1]?.role ?? '',
      status: checkStatusView(step.status),
      title: step.agent,
      summary: step.summary,
      // The pipeline is deterministic and LLM-free, so there is no wall-clock
      // duration worth reporting; the run list shows the step instead.
      durationMs: 0,
      deltaId: step.deltaId,
    })),
    deltas,
    policy: policyView(run.screen),
    metrics:
      run.metrics === null
        ? null
        : {
            occlusion: run.metrics.occlusion,
            meanFlow: run.metrics.meanFlow,
            sickledFraction: run.metrics.sickledFraction,
          },
    limitation: run.limitation,
    mergeBlockedReason: gate.ok ? null : gate.reason,
    signoff: signoff === undefined ? null : { role: signoff.role, by: signoff.by, at: signoff.at },
  };
}

function editView(variant: LocusVariant): EditView {
  return {
    label: variant.label,
    gene: variant.gene,
    codonIndex: variant.codonIndex,
    refCodon: variant.refCodon,
    altCodon: variant.altCodon,
    kind: variant.kind,
    provenance: variant.provenance,
    hgvs: variant.hgvs ?? null,
    proteinHgvs: variant.proteinHgvs ?? null,
    legacyName: variant.legacyName ?? null,
    numberingNote: variant.numberingNote ?? null,
    refAa: variant.structural.refAa,
    altAa: variant.structural.altAa,
    refAaName: variant.structural.refAaName,
    altAaName: variant.structural.altAaName,
    summary: variant.structural.summary,
    consequence: variant.structural.consequence,
    confidence: variant.structural.confidence,
    limitation: variant.structural.limitation,
  };
}

function diffView(
  refBases: string,
  refLabel: string,
  altBases: string,
  altLabel: string,
): DiffView {
  const rows: DiffRow[] = diffSequences(
    { bases: refBases, label: refLabel },
    { bases: altBases, label: altLabel },
  );
  return {
    refLabel,
    altLabel,
    rows,
    changedCodons: rows.filter((r) => r.status !== 'same').map((r) => r.codonIndex),
  };
}

function toLayoutCommit(entry: BuiltCommit): LayoutCommit {
  return { oid: entry.oid, parents: entry.commit.parents, timestamp: entry.commit.timestamp };
}

/**
 * Build the whole demo. Deterministic in `input`: given the same applied
 * merges and signoffs it produces identical oids, checks and geometry.
 */
export function buildScenario(input: ScenarioInput = {}): Scenario {
  const locus = requireLocus(GENE);
  const variantOf = (id: string): LocusVariant => requireVariant(locus, id);

  const repo = new Repo();
  const built = new Map<Oid, BuiltCommit>();
  const tipOf = new Map<string, Oid>();
  const runByBranch = new Map<string, PipelineRun>();
  const signoffRequests = input.signoffs ?? [];

  const reference = { bases: locus.cdsReference.bases, label: locus.cdsReference.label };

  const treeFor = (bases: string, label: string): Oid => {
    const blob = repo.write({ kind: 'blob', sequence: { bases, label } });
    return repo.write({ kind: 'tree', entries: { [GENE]: blob } });
  };

  const record = (
    oid: Oid,
    bases: string,
    label: string,
    edit: LocusVariant | null,
    run: PipelineRun | null,
  ): void => {
    const commit = repo.read(oid);
    if (commit.kind !== 'commit') throw new Error('expected a commit');
    built.set(oid, {
      oid,
      commit,
      bases,
      edit,
      run,
      genotype: genotypeView(locus, bases, label),
    });
  };

  // ── Root: import the reference allele ───────────────────────────────────
  // `main` is the Repo's default current branch, so the first commit creates it.
  const rootOid = repo.commit({
    tree: treeFor(reference.bases, reference.label),
    author: AUTHOR,
    message: `Import ${GENE} reference allele — ${reference.label}`,
    timestamp: BASE_TIME,
    parents: [],
  });
  repo.branch(MAIN, rootOid);
  record(rootOid, reference.bases, reference.label, null, null);
  tipOf.set(MAIN, rootOid);

  // ── Proposals ───────────────────────────────────────────────────────────
  for (const proposal of PROPOSALS) {
    const continuing = proposal.branch !== MAIN && tipOf.has(proposal.branch);
    const forkTip = tipOf.get(proposal.forkFrom);
    if (forkTip === undefined) throw new Error(`cannot fork from ${proposal.forkFrom}`);
    const forkEntry = built.get(forkTip);
    if (forkEntry === undefined) throw new Error(`missing fork commit ${forkTip}`);

    const variant = proposal.variantId === null ? null : variantOf(proposal.variantId);
    const baselineBases =
      variant === null
        ? forkEntry.bases
        : applyVariant({ bases: forkEntry.bases, label: forkEntry.genotype.label }, variant).bases;
    const baselineGenotype = genotypeView(
      locus,
      baselineBases,
      variant === null ? forkEntry.genotype.label : variant.label,
    );

    // The pipeline resolves its own intent from the proposal's text, exactly
    // as the red-team console does — there is no privileged path in. The
    // verifier re-runs the simulation itself, which is what lets it disagree
    // with the structural claim.
    const run = runProposalPipeline({
      id: proposal.runId,
      requestText: proposal.requestText,
      // Re-pointed at the real oid below, once the commit exists.
      commit: forkTip,
      plannedVariantId: proposal.variantId,
    });

    // A blocked run planned no edit, so the genotype is unchanged and the
    // commit message names the policy category only — never the request.
    const blocked = run.verdict === 'blocked';
    const bases = blocked ? forkEntry.bases : baselineBases;
    const label = blocked ? forkEntry.genotype.label : baselineGenotype.label;
    const message = blocked
      ? `Refused proposal — biosafety gate returned ${run.screen.category} ` +
        `(digest ${run.screen.requestDigest}; request text not retained)`
      : proposal.message;

    if (proposal.branch !== MAIN && !continuing) repo.branch(proposal.branch, forkTip);
    repo.checkout(proposal.branch);
    const oid = repo.commit({
      tree: treeFor(bases, label),
      author: AUTHOR,
      message,
      timestamp: BASE_TIME + proposal.hoursAfterBase * HOUR,
      parents: [forkTip],
      ...(blocked || variant === null ? {} : { edit: variant satisfies Variant }),
      checkRunId: run.id,
    });
    // The gate looks a check up by the commit it was computed for, so the
    // check is attributed to this commit now that its oid exists. A check
    // recorded against any other commit does not clear this one.
    const attributed: PipelineRun = { ...run, check: { ...run.check, commit: oid } };
    record(oid, bases, label, blocked ? null : variant, attributed);
    tipOf.set(proposal.branch, oid);
    runByBranch.set(proposal.branch, attributed);
  }

  // ── Merges: the seeded one, then anything the user has applied ──────────
  const appliedMerges: MergeRequest[] = [];
  const requested = [SEEDED_MERGE, ...(input.appliedMerges ?? [])];

  const signoffFor = (branch: string): Signoff | undefined =>
    resolveSignoff(runByBranch.get(branch), signoffRequests, branch);

  for (const request of requested) {
    const gate = mergeGate(request, runByBranch, signoffFor(request.from));
    if (gate !== null) continue; // refused; never applied to the history
    const ours = tipOf.get(request.into);
    const theirs = tipOf.get(request.from);
    if (ours === undefined || theirs === undefined) continue;
    repo.checkout(request.into);
    const result: MergeResult = repo.merge(ours, theirs);
    if (!('oid' in result)) continue; // conflict; nothing is committed
    const mergeCommit = repo.read(result.oid);
    if (mergeCommit.kind !== 'commit') continue;
    const treeObj = repo.read(mergeCommit.tree);
    if (treeObj.kind !== 'tree') continue;
    const blobOid = treeObj.entries[GENE];
    const blob = blobOid === undefined ? undefined : repo.read(blobOid);
    const bases =
      blob !== undefined && blob.kind === 'blob'
        ? blob.sequence.bases
        : (built.get(ours)?.bases ?? reference.bases);
    const label =
      blob !== undefined && blob.kind === 'blob' ? blob.sequence.label : reference.label;
    record(result.oid, bases, label, null, null);
    tipOf.set(request.into, result.oid);
    appliedMerges.push(request);
  }

  return {
    repo,
    runByBranch,
    tipOf,
    view: buildView({
      locus,
      built,
      tipOf,
      runByBranch,
      signoffFor,
      appliedMerges: appliedMerges.filter(
        (m) => !(m.into === SEEDED_MERGE.into && m.from === SEEDED_MERGE.from),
      ),
      signoffs: signoffRequests,
    }),
  };
}

/**
 * Stand-in for the part of `EditPlannerAgent` that picks *which* curated edit
 * a free-text proposal is asking for. The real agent resolves against
 * data/loci.json itself (SPEC §4.3); this exists so the red-team console can
 * drive a full seven-agent run, and should go away at integration.
 *
 * Deliberately crude and keyword-based, like the rest of the LLM-free demo: a
 * judge can re-derive which variant any phrasing selects.
 */
function planVariantFor(locus: Locus, text: string): LocusVariant | undefined {
  const lower = text.toLowerCase();
  const has = (...needles: readonly string[]): boolean =>
    needles.some((n) => lower.includes(n));
  if (has('silent', 'synonymous', 'marker', 'tag', 'label')) {
    return getVariant(locus, 'HBB_silent_demo');
  }
  if (has('sickle allele', 'hbs', 'record', 'baseline', 'introduce')) {
    return getVariant(locus, 'HBB_HbS');
  }
  if (has('repair', 'restore', 'correct', 'revert', 'fix')) {
    return getVariant(locus, 'HBB_repair');
  }
  return undefined;
}

export interface ProposalRun {
  readonly id: string;
  /** The full seven-agent run, already flattened for rendering. */
  readonly run: RunView;
  /** Derived, non-verbatim: how many tokens the proposal had. */
  readonly tokenCount: number;
  /** Curated loci resolved. Empty when the result is redacted. */
  readonly resolvedTargets: readonly string[];
  readonly plannedVariantLabel: string | null;
}

const WORD_RE = /[a-z0-9']+/g;

/**
 * Run the real seven-agent pipeline on a free-text proposal.
 *
 * The text goes in; **no text comes out.** `RunView` and `ProposalRun` have no
 * field that can carry it, the pipeline's own delta payloads record only
 * derived facts, and a `block` verdict terminates the run at step 2 with
 * steps 3–7 recorded as skipped (SPEC §7.3, §7.4).
 */
export function runProposal(text: string, targets: readonly string[]): ProposalRun {
  const trimmed = text.trim();
  const locus = requireLocus(GENE);
  const planned = targets.includes(GENE) ? planVariantFor(locus, trimmed) : undefined;

  /*
   * Known limitation, stated here because this is where it bites.
   *
   * `EditPlannerAgent` resolves the edit against data/loci.json and the assay
   * runs on the genotype the fixture names for it — so the pipeline is
   * branch-blind. The same edit proposed on the reference allele and on the
   * sickle allele assays identically, when in the model they would not. A
   * console run has no branch at all, so nothing is lost here; a branch run
   * loses the baseline's contribution. Fixing it properly means giving
   * `PipelineInput` the branch's baseline genotype, which is a change to the
   * agent contract rather than to this file.
   */
  const digest = digestRequest(trimmed);
  // A console run is not attributed to a commit: nothing is proposed, so there
  // is nothing to merge and the gate never looks this check up.
  const run = runProposalPipeline({
    id: `console-${digest}`,
    requestText: trimmed,
    commit: CONSOLE_COMMIT,
    plannedVariantId: planned?.id ?? null,
  });

  return {
    id: `console-${digest}`,
    run: runView(run, undefined),
    tokenCount: (trimmed.toLowerCase().match(WORD_RE) ?? []).length,
    resolvedTargets: run.screen.redacted ? [] : targets,
    plannedVariantLabel: run.screen.redacted ? null : (planned?.label ?? null),
  };
}

/**
 * Turn a client-supplied sign-off into one the gate will accept — or into
 * nothing at all.
 *
 * The role is taken from the **policy's** `signoffRole` for that branch's run,
 * never from the request. A client therefore cannot name the role that clears
 * an escalation; all it can supply is the attributed signer. A run that is not
 * escalated, or that the policy gave no role, yields no sign-off, so a `block`
 * can never be cleared this way (SPEC §7.5).
 *
 * This is the single place a `Signoff` is constructed. Keep it that way: an
 * second construction site is how the forged-role hole comes back.
 */
export function resolveSignoff(
  run: PipelineRun | undefined,
  requests: readonly SignoffRequest[],
  branch: string,
): Signoff | undefined {
  if (run === undefined) return undefined;
  const match = requests.find((s) => s.branch === branch);
  if (match === undefined) return undefined;

  // The decision, and the role, come from `lib/merge-gate`: it reads the role
  // off the check that `checkRunFromPipeline` derived from the policy verdict,
  // and refuses a refusal, a non-escalation and a second sign-off. Deciding it
  // here as well is how the two copies drift apart.
  const resolved = resolvePolicySignoff(run.check, match.by);
  if (!resolved.ok) return undefined;
  return { runId: run.id, role: resolved.role, by: match.by, at: BASE_TIME + 24 * HOUR };
}

/**
 * Is this merge refused before `Repo.merge` is even consulted?
 *
 * This is the merge gate, and it is deliberately *here* — in the pure layer,
 * on the server — not in the UI. A failing or escalated check does not merely
 * annotate the merge button; it short-circuits the merge itself, so a client
 * that posts a merge request directly still cannot get past it (SPEC §7.4,
 * §7.5, §9.6).
 */
export function mergeGate(
  request: MergeRequest,
  runByBranch: ReadonlyMap<string, PipelineRun>,
  signoff: Signoff | undefined,
): { readonly reason: string; readonly category: string; readonly verdict: RunVerdictView; readonly requiresSignoffBy: string | null } | null {
  const run = runByBranch.get(request.from);
  if (run === undefined) return null; // nothing was proposed on that branch
  const gate = isMergeable(run, signoff === undefined ? [] : [signoff]);
  if (gate.ok) return null;
  return {
    reason: gate.reason,
    category: run.screen.category,
    verdict: run.verdict,
    requiresSignoffBy: run.screen.requiresSignoff ? (run.screen.signoffRole ?? null) : null,
  };
}

interface ViewInput {
  readonly locus: Locus;
  readonly built: ReadonlyMap<Oid, BuiltCommit>;
  readonly tipOf: ReadonlyMap<string, Oid>;
  readonly runByBranch: ReadonlyMap<string, PipelineRun>;
  readonly signoffFor: (branch: string) => Signoff | undefined;
  readonly appliedMerges: readonly MergeRequest[];
  readonly signoffs: readonly SignoffRequest[];
}

function buildView(input: ViewInput): ScenarioView {
  const { locus, built, tipOf } = input;
  const reference = locus.cdsReference;

  const branchesAt = new Map<Oid, string[]>();
  for (const [name, oid] of [...tipOf.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const list = branchesAt.get(oid) ?? [];
    list.push(name);
    branchesAt.set(oid, list);
  }

  const layout = layoutGraph([...built.values()].map(toLayoutCommit));

  const commits: CommitView[] = layout.nodes.map((node) => {
    const entry = built.get(node.oid);
    if (entry === undefined) throw new Error(`layout produced an unknown node ${node.oid}`);
    const signoff = (() => {
      const branch = (branchesAt.get(node.oid) ?? []).find(
        (name) => input.signoffFor(name) !== undefined,
      );
      return branch === undefined ? undefined : input.signoffFor(branch);
    })();
    const firstParent = entry.commit.parents[0];
    const parentEntry = firstParent === undefined ? undefined : built.get(firstParent);
    return {
      oid: entry.oid,
      short: shortOid(entry.oid),
      parents: [...entry.commit.parents],
      author: entry.commit.author,
      message: entry.commit.message,
      timestamp: entry.commit.timestamp,
      isMerge: node.isMerge,
      isRoot: node.isRoot,
      branches: branchesAt.get(node.oid) ?? [],
      edit: entry.edit === null ? null : editView(entry.edit),
      genotype: entry.genotype,
      run: entry.run === null ? null : runView(entry.run, signoff),
      status: entry.run === null ? 'none' : entry.run.verdict,
      diffVsParent:
        parentEntry === undefined
          ? null
          : diffView(
              parentEntry.bases,
              `${shortOid(parentEntry.oid)} · ${parentEntry.genotype.label}`,
              entry.bases,
              `${shortOid(entry.oid)} · ${entry.genotype.label}`,
            ),
      diffVsReference: diffView(
        reference.bases,
        reference.label,
        entry.bases,
        `${shortOid(entry.oid)} · ${entry.genotype.label}`,
      ),
    };
  });

  const commitByOid = new Map(commits.map((c) => [c.oid, c]));
  const headTip = tipOf.get(MAIN);
  const headAncestry = new Set<string>();
  if (headTip !== undefined) {
    const stack = [headTip];
    while (stack.length > 0) {
      const oid = stack.pop();
      if (oid === undefined || headAncestry.has(oid)) continue;
      headAncestry.add(oid);
      for (const parent of built.get(oid)?.commit.parents ?? []) stack.push(parent);
    }
  }

  const branches: BranchView[] = [...tipOf.entries()]
    .sort((a, b) => (a[0] === MAIN ? -1 : b[0] === MAIN ? 1 : a[0].localeCompare(b[0])))
    .map(([name, tip]) => {
      const commit = commitByOid.get(tip);
      const run = input.runByBranch.get(name);
      const signoff = input.signoffFor(name);
      const gate =
        run === undefined
          ? null
          : mergeGate({ into: MAIN, from: name }, input.runByBranch, signoff);
      // Commits on this branch that main cannot already reach.
      let ahead = 0;
      const seen = new Set<string>();
      const stack = [tip];
      while (stack.length > 0) {
        const oid = stack.pop();
        if (oid === undefined || seen.has(oid) || headAncestry.has(oid)) continue;
        seen.add(oid);
        ahead += 1;
        for (const parent of built.get(oid)?.commit.parents ?? []) stack.push(parent);
      }
      return {
        name,
        tip,
        shortTip: shortOid(tip),
        isHead: name === MAIN,
        status: commit?.status ?? 'none',
        tipMessage: commit?.message ?? '',
        ahead,
        mergeBlockedReason: gate === null ? null : gate.reason,
      };
    });

  const label = (oid: string): string => {
    const commit = commitByOid.get(oid);
    if (commit === undefined) return shortOid(oid);
    const refs = commit.branches.length > 0 ? ` (${commit.branches.join(', ')})` : '';
    return `${commit.short}${refs}, ${commit.message}`;
  };

  const description = describeGraph(layout, label).map((line, index) => {
    const node = layout.nodes[index];
    const commit = node === undefined ? undefined : commitByOid.get(node.oid);
    if (commit === undefined) return line;
    const verdict =
      commit.status === 'none'
        ? 'no agent checks were run for this commit'
        : `agent check verdict: ${commit.status}`;
    return `${line} ${verdict.charAt(0).toUpperCase()}${verdict.slice(1)}.`;
  });

  return {
    commits,
    branches,
    graph: {
      nodes: layout.nodes,
      edges: layout.edges,
      laneCount: layout.laneCount,
      rowCount: layout.rowCount,
      width: layout.width,
      height: layout.height,
      rowHeight: layout.metrics.rowHeight,
      laneWidth: layout.metrics.laneWidth,
      description,
    },
    locus: {
      gene: locus.gene,
      name: locus.name,
      chromosome: locus.chromosome,
      note: locus.note,
      provenance: locus.provenance,
      referenceLabel: reference.label,
      referenceBases: reference.bases,
      referenceProtein: translate(reference.bases),
      codonCount: reference.codonCount,
      declaredCodonCount: reference.declaredCodonCount,
      startCodon: reference.startCodon,
      exons: locus.exons.map((exon) => ({
        index: exon.index,
        label: exon.label,
        codonStart: exon.codonStart,
        codonEnd: exon.codonEnd,
        note: exon.note,
        modelled: exon.modelled,
        partiallyModelled: exon.partiallyModelled,
      })),
      totalCodons: locus.exons.reduce((max, exon) => Math.max(max, exon.codonEnd), 0),
    },
    simulation: {
      note: SIMULATION.note,
      seed: SIMULATION.defaults.seed,
      cellCount: SIMULATION.defaults.cellCount,
      defaultPO2: SIMULATION.defaults.pO2,
      capillaryConstriction: SIMULATION.defaults.capillaryConstriction,
      pO2Min: SIMULATION.pO2.min,
      pO2Max: SIMULATION.pO2.max,
      pO2Unit: SIMULATION.pO2.unit,
      pO2Label: SIMULATION.pO2.label,
      sicklingOnsetBelow: SIMULATION.pO2.sicklingOnsetBelow,
    },
    headBranch: MAIN,
    disclaimer: LOCI_DISCLAIMER,
    appliedMerges: input.appliedMerges,
    signoffs: input.signoffs,
  };
}

/**
 * Attempt a merge. The gate is checked first, server-side, from the rebuilt
 * pipeline results — not from anything the client sent.
 */
export function attemptMerge(input: ScenarioInput, request: MergeRequest): MergeOutcome {
  const before = buildScenario(input);
  const signoff = resolveSignoff(
    before.runByBranch.get(request.from),
    input.signoffs ?? [],
    request.from,
  );

  const blocked = mergeGate(request, before.runByBranch, signoff);
  if (blocked !== null) {
    return {
      kind: 'blocked',
      into: request.into,
      from: request.from,
      reason: blocked.reason,
      category: blocked.category,
      verdict: blocked.verdict,
      requiresSignoffBy: blocked.requiresSignoffBy,
    };
  }

  const ours = before.tipOf.get(request.into);
  const theirs = before.tipOf.get(request.from);
  if (ours === undefined || theirs === undefined) {
    return {
      kind: 'error',
      into: request.into,
      from: request.from,
      reason: 'One of the two branches could not be resolved to a commit.',
    };
  }

  // Already up to date: `theirs` is an ancestor of `ours`, so there is nothing
  // to merge. Without this, re-merging a merged branch appends a fresh merge
  // commit every time and the history grows without bound.
  if (before.repo.mergeBase(ours, theirs) === theirs) {
    return {
      kind: 'error',
      into: request.into,
      from: request.from,
      reason: `${request.into} already contains ${request.from}. Nothing to merge.`,
    };
  }

  before.repo.checkout(request.into);
  const result = before.repo.merge(ours, theirs);

  if (!('oid' in result)) {
    const describe = (oid: string | null): string => {
      if (oid === null) return 'absent';
      const obj = before.repo.read(oid);
      if (obj.kind !== 'blob') return shortOid(oid);
      return `${obj.sequence.label} (${shortOid(oid)})`;
    };
    return {
      kind: 'conflict',
      into: request.into,
      from: request.from,
      baseOid: before.repo.mergeBase(ours, theirs),
      conflicts: result.conflicts.map(
        (conflict): ConflictView => ({
          gene: conflict.gene,
          base: conflict.base,
          ours: conflict.ours,
          theirs: conflict.theirs,
          baseLabel: describe(conflict.base),
          oursLabel: describe(conflict.ours),
          theirsLabel: describe(conflict.theirs),
        }),
      ),
    };
  }

  // Clean. Rebuild the whole scenario with the merge applied so the client gets
  // a graph that includes the new merge commit, laid out from real ancestry.
  const applied = [...(input.appliedMerges ?? []), request];
  const after = buildScenario({ ...input, appliedMerges: applied });
  const merged = after.tipOf.get(request.into);
  if (merged === undefined) {
    return {
      kind: 'error',
      into: request.into,
      from: request.from,
      reason: 'The merge produced no new tip.',
    };
  }
  const oursTree = (() => {
    const commit = before.repo.read(ours);
    return commit.kind === 'commit' ? commit.tree : null;
  })();
  const theirsTree = (() => {
    const commit = before.repo.read(theirs);
    return commit.kind === 'commit' ? commit.tree : null;
  })();

  return {
    kind: 'clean',
    into: request.into,
    from: request.from,
    mergeOid: merged,
    short: shortOid(merged),
    identical: oursTree !== null && oursTree === theirsTree,
    scenario: after.view,
  };
}
