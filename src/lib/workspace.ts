// Variant-local glue — NOT a stub.
//
// Builds the one repository this prototype demonstrates: a reference branch,
// a patient-baseline branch, and two proposed-edit branches, all from the
// orchestrator-authored fixture at `src/data/loci.json` through `lib/vcs`,
// `lib/genome` and `lib/cellsim`.
//
// Why it lives in `lib/`: it is pure, deterministic and framework-free, and
// the UI needs a serialisable snapshot of repository state rather than live
// `Repo` instances. SPEC §3 does not name this file; it is this variant's own
// composition layer and is flagged as such in the final report.
//
// It imports `lib/vcs`, which hashes with `node:crypto`, so it is server-side
// only by construction. `buildWorkspace()` runs in a server component; the
// client receives the plain snapshot below.

import { PO2_RANGE, SIMULATION_DEFAULTS, SIMULATION_NOTE } from '@/lib/cellsim';
import {
  applyVariant,
  codons,
  diffSequences,
  FIXTURE_DISCLAIMER,
  getLocus,
  type DiffRow,
  type LocusExon,
  type LocusVariant,
  type Sequence,
} from '@/lib/genome';
import { oidOf, Repo, shortOid, type Oid } from '@/lib/vcs';

/** Fixed timestamps keep the oids identical across runs (SPEC §4.2). */
const EPOCH = Date.UTC(2026, 2, 8, 9, 0, 0);
const MINUTE = 60_000;

export const AUTHOR = 'r.okonjo@sigmafold.dev';

export interface CommitView {
  readonly oid: Oid;
  readonly short: string;
  readonly message: string;
  readonly author: string;
  readonly timestamp: number;
  readonly parents: readonly string[];
  readonly editLabel: string | null;
  readonly editCodonIndex: number | null;
}

export interface BranchView {
  readonly name: string;
  readonly description: string;
  /** Indentation level — the DAG's shape, implied rather than drawn. */
  readonly depth: number;
  readonly baseBranch: string | null;
  readonly headOid: Oid;
  readonly headShort: string;
  readonly isDefault: boolean;
  readonly commits: readonly CommitView[];
  /** Fixture variant ids present before this branch's own edit. */
  readonly baselineVariantIds: readonly string[];
  /** The fixture variant id this branch introduces, if any. */
  readonly editVariantId: string | null;
  readonly editCodonIndex: number | null;
  readonly genotypeLabel: string;
  readonly polymerizationTendency: number;
  /** Sequence this branch is diffed against (its base branch's genotype). */
  readonly refSequence: Sequence;
  readonly altSequence: Sequence;
  readonly diff: readonly DiffRow[];
  /** The request this branch's pipeline run screens. Authored, not lorem. */
  readonly defaultRequest: string;
}

export interface WorkspaceSnapshot {
  readonly gene: string;
  readonly geneName: string;
  readonly chromosome: string;
  readonly locusNote: string;
  readonly provenance: string;
  readonly exons: readonly LocusExon[];
  /** Codons actually present in the reference region (derived, not declared). */
  readonly modelledCodonCount: number;
  /** What `cdsReference.codonCount` claims, for comparison. */
  readonly declaredCodonCount: number;
  readonly totalCodonCount: number;
  readonly variants: readonly LocusVariant[];
  readonly branches: readonly BranchView[];
  readonly defaultBranch: string;
  readonly fixtureDisclaimer: string;
  readonly simulationNote: string;
  readonly simulation: typeof SIMULATION_DEFAULTS;
  readonly pO2: typeof PO2_RANGE;
}

interface BranchPlan {
  readonly name: string;
  readonly description: string;
  readonly depth: number;
  readonly base: string | null;
  readonly variantId: string | null;
  readonly message: string;
  readonly defaultRequest: string;
}

const BRANCH_PLAN: readonly BranchPlan[] = [
  {
    name: 'main',
    description: 'HBB reference region (HbA). The allele every diff is measured against.',
    depth: 0,
    base: null,
    variantId: null,
    message: 'import HBB reference coding region (HbA)',
    defaultRequest:
      'Review the curated HBB reference allele. No edit is proposed on this branch.',
  },
  {
    name: 'patient/hbss-baseline',
    description: 'Homozygous HbS baseline. Branched from main; this is what an edit starts from.',
    depth: 1,
    base: 'main',
    variantId: 'HBB_HbS',
    message: 'record HbS/HbS baseline genotype at HBB codon 7',
    defaultRequest:
      'Record the HbS/HbS baseline genotype at HBB so later edits have a reference to improve on.',
  },
  {
    name: 'edit/hbb-codon7-repair',
    description: 'Proposed repair: restore the reference codon at HBB codon 7.',
    depth: 2,
    base: 'patient/hbss-baseline',
    variantId: 'HBB_repair',
    message: 'restore reference codon at HBB codon 7',
    defaultRequest:
      'Restore the reference codon at HBB codon 7 in somatic haematopoietic cells in order to treat sickle cell disease.',
  },
  {
    name: 'edit/hbb-silent-probe',
    description: 'Synthetic silent substitution at codon 5 — exercises the diff, repairs nothing.',
    depth: 2,
    base: 'patient/hbss-baseline',
    variantId: 'HBB_silent_demo',
    message: 'synthetic silent substitution at HBB codon 5',
    defaultRequest:
      'Apply the synthetic silent substitution at HBB codon 5 to the patient baseline and check whether it improves flow.',
  },
];

function sequenceFor(
  reference: Sequence,
  variants: readonly LocusVariant[],
  appliedIds: readonly string[],
  label: string,
): Sequence {
  let seq: Sequence = { bases: reference.bases, label };
  for (const id of appliedIds) {
    const v = variants.find((candidate) => candidate.id === id);
    if (v === undefined) continue;
    seq = { bases: applyOne(seq, v).bases, label };
  }
  return seq;
}

function applyOne(seq: Sequence, v: LocusVariant): Sequence {
  // `applyVariant` relabels the result after its own variant; the caller keeps
  // the genotype label, so the label is restored here.
  const applied = applyVariant(seq, v);
  return { bases: applied.bases, label: seq.label };
}

/** Variant ids applied on a branch, including inherited ones. */
function lineageVariantIds(name: string): string[] {
  const plan = BRANCH_PLAN.find((b) => b.name === name);
  if (plan === undefined) return [];
  const inherited = plan.base === null ? [] : lineageVariantIds(plan.base);
  return plan.variantId === null ? inherited : [...inherited, plan.variantId];
}

function tendencyFor(gene: string, appliedIds: readonly string[]): { label: string; tendency: number } {
  const locus = getLocus(gene);
  if (locus === undefined) return { label: 'unknown genotype', tendency: 0 };
  const key = [...appliedIds].sort().join('|');
  const named = locus.genotypes.find((g) => [...g.appliedVariants].sort().join('|') === key);
  if (named !== undefined) return { label: named.label, tendency: named.polymerizationTendency };
  const worst = appliedIds
    .map((id) => locus.variants.find((v) => v.id === id)?.structural.polymerizationTendency ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
  return { label: 'composite genotype (not a named fixture)', tendency: worst };
}

/**
 * The live repository plus its snapshot.
 *
 * `Repo` is not serialisable and hashes with `node:crypto`, so it never
 * crosses to the client — a server action keeps it and hands on `snapshot`
 * alone. The merge gate needs the real repository and the real branch heads:
 * evaluating a merge against a repository rebuilt from the snapshot would be
 * evaluating a different object graph than the one the UI is showing.
 */
export interface OpenWorkspace {
  readonly snapshot: WorkspaceSnapshot;
  readonly repo: Repo;
  /** Branch name → head oid, for the branches in `snapshot.branches`. */
  readonly heads: ReadonlyMap<string, Oid>;
}

/**
 * Build the demonstration repository and snapshot it. Deterministic: same
 * fixture in, same oids out.
 */
export function buildWorkspace(gene = 'HBB'): WorkspaceSnapshot {
  return openWorkspace(gene).snapshot;
}

/** As `buildWorkspace`, but keeping the live repository. Server-side only. */
export function openWorkspace(gene = 'HBB'): OpenWorkspace {
  const locus = getLocus(gene);
  if (locus === undefined) throw new Error(`no curated locus for ${gene}`);

  const reference: Sequence = {
    bases: locus.cdsReference.bases.toUpperCase(),
    label: locus.cdsReference.label,
  };

  const repo = new Repo();
  const heads = new Map<string, Oid>();
  const commitsByBranch = new Map<string, CommitView[]>();

  BRANCH_PLAN.forEach((plan, i) => {
    const applied = lineageVariantIds(plan.name);
    const { label } = tendencyFor(gene, applied);
    const seq = sequenceFor(reference, locus.variants, applied, label);
    const blob = repo.write({ kind: 'blob', sequence: seq });
    const tree = repo.write({ kind: 'tree', entries: { [gene]: blob } });

    const parentOid = plan.base === null ? undefined : heads.get(plan.base);
    const fixtureVariant =
      plan.variantId === null ? undefined : locus.variants.find((v) => v.id === plan.variantId);

    // `branch` then `checkout` so `commit` advances the right ref, exactly as
    // the SPEC §4.2 surface intends. The root commit has no parent and lands
    // on the default branch, which is already current; `Repo.branch` requires
    // an existing commit, so it is skipped for that first write.
    if (parentOid !== undefined) {
      repo.branch(plan.name, parentOid);
      repo.checkout(plan.name);
    }

    const oid = repo.commit({
      tree,
      parents: parentOid === undefined ? [] : [parentOid],
      author: AUTHOR,
      message: plan.message,
      timestamp: EPOCH + i * 7 * MINUTE,
      ...(fixtureVariant === undefined ? {} : { edit: fixtureVariant }),
    });
    heads.set(plan.name, oid);
  });

  // Snapshot each branch's commit list by walking its own history.
  for (const plan of BRANCH_PLAN) {
    const head = heads.get(plan.name);
    if (head === undefined) continue;
    const commits = repo.log(plan.name);
    commitsByBranch.set(
      plan.name,
      commits.map((c) => {
        const oid = oidOf(c);
        return {
          oid,
          short: shortOid(oid),
          message: c.message,
          author: c.author,
          timestamp: c.timestamp,
          parents: c.parents.map((parent) => shortOid(parent)),
          editLabel: c.edit?.label ?? null,
          editCodonIndex: c.edit?.codonIndex ?? null,
        };
      }),
    );
  }

  const branches: BranchView[] = BRANCH_PLAN.map((plan) => {
    const applied = lineageVariantIds(plan.name);
    const baseline = plan.base === null ? [] : lineageVariantIds(plan.base);
    const { label, tendency } = tendencyFor(gene, applied);
    const baseLabel = tendencyFor(gene, baseline).label;

    const altSequence = sequenceFor(reference, locus.variants, applied, label);
    const refSequence =
      plan.base === null
        ? reference
        : sequenceFor(reference, locus.variants, baseline, baseLabel);

    const head = heads.get(plan.name);
    if (head === undefined) throw new Error(`branch ${plan.name} has no head`);

    const fixtureVariant =
      plan.variantId === null ? undefined : locus.variants.find((v) => v.id === plan.variantId);

    return {
      name: plan.name,
      description: plan.description,
      depth: plan.depth,
      baseBranch: plan.base,
      headOid: head,
      headShort: shortOid(head),
      isDefault: plan.name === 'main',
      commits: commitsByBranch.get(plan.name) ?? [],
      baselineVariantIds: baseline,
      editVariantId: plan.variantId,
      editCodonIndex: fixtureVariant?.codonIndex ?? null,
      genotypeLabel: label,
      polymerizationTendency: tendency,
      refSequence,
      altSequence,
      diff: diffSequences(refSequence, altSequence),
      defaultRequest: plan.defaultRequest,
    };
  });

  const lastExon = locus.exons[locus.exons.length - 1];

  const snapshot: WorkspaceSnapshot = {
    gene: locus.gene,
    geneName: locus.name,
    chromosome: locus.chromosome,
    locusNote: locus.note,
    provenance: locus.provenance,
    exons: locus.exons,
    // Derived from the sequence as a check against `cdsReference.codonCount`.
    // On the HBB fixture they agree: codonCount is 31 and bases is 93 nt.
    modelledCodonCount: codons(reference.bases).length,
    declaredCodonCount: locus.cdsReference.codonCount,
    totalCodonCount:
      lastExon === undefined ? codons(reference.bases).length : lastExon.codonEnd,
    variants: locus.variants,
    branches,
    defaultBranch: 'edit/hbb-codon7-repair',
    fixtureDisclaimer: FIXTURE_DISCLAIMER,
    simulationNote: SIMULATION_NOTE,
    simulation: SIMULATION_DEFAULTS,
    pO2: PO2_RANGE,
  };

  return { snapshot, repo, heads };
}

/** Merge gate target: branches are merged into the patient baseline. */
export function mergeTargetFor(branch: BranchView): string | null {
  return branch.baseBranch;
}
