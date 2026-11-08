/**
 * Serializable view model handed from the server to the client.
 *
 * Types only — this module imports nothing that touches `node:crypto`, so it
 * is safe to import from Client Components. Everything here is plain JSON.
 *
 * One structural safety property, deliberate and load-bearing (SPEC §7.3):
 * **no type in this file has a field for a user's request text.** The server
 * never sends request text back to the client, for allowed or refused
 * requests alike, so there is no path by which refused input can reach the
 * DOM, a log line or the delta trail. Requests are identified by their policy
 * digest instead.
 */

import type { DiffRow } from '@/lib/genome';
import type { LayoutEdge, LayoutNode } from '@/lib/graph/layout';

export type PolicyVerdict = 'allow' | 'escalate' | 'block';
export type CheckStatusView = 'pass' | 'fail' | 'blocked' | 'escalated' | 'skipped';
export type RunVerdictView = 'pass' | 'fail' | 'blocked' | 'escalated';
/** `none` = a commit that proposed nothing, so there is nothing to check. */
export type NodeStatus = RunVerdictView | 'none';

export interface PolicyView {
  readonly category: string;
  readonly verdict: PolicyVerdict;
  readonly reason: string;
  readonly requiresSignoff: boolean;
  readonly signoffRole: string | null;
  readonly flaggedGenes: readonly string[];
  /** sha256 prefix. The only identifier kept for a refused request. */
  readonly requestDigest: string;
  readonly redacted: boolean;
}

/** One `label: value` row of a delta payload, pre-flattened on the server. */
export interface DeltaField {
  readonly label: string;
  readonly value: string;
}

export interface DeltaView {
  readonly id: string;
  readonly kind: string;
  readonly author: string;
  readonly createdAt: number;
  readonly parents: readonly string[];
  readonly fields: readonly DeltaField[];
}

export interface CheckView {
  readonly id: string;
  readonly step: number;
  readonly agent: string;
  readonly role: string;
  readonly status: CheckStatusView;
  readonly title: string;
  readonly summary: string;
  readonly durationMs: number;
  readonly deltaId: string | null;
}

export interface MetricsView {
  readonly occlusion: number;
  readonly meanFlow: number;
  readonly sickledFraction: number;
}

export interface SignoffView {
  readonly role: string;
  readonly by: string;
  readonly at: number;
}

export interface RunView {
  readonly id: string;
  readonly verdict: RunVerdictView;
  readonly checks: readonly CheckView[];
  readonly deltas: readonly DeltaView[];
  readonly policy: PolicyView;
  readonly metrics: MetricsView | null;
  /** Illustrative-model notice for the numbers this run produced (SPEC §7.7). */
  readonly limitation: string | null;
  /** Non-null when this run's commit may not be merged, with the reason. */
  readonly mergeBlockedReason: string | null;
  readonly signoff: SignoffView | null;
}

export interface EditView {
  readonly label: string;
  readonly gene: string;
  readonly codonIndex: number;
  readonly refCodon: string;
  readonly altCodon: string;
  readonly kind: 'substitution' | 'deletion' | 'insertion';
  readonly provenance: 'public-reference' | 'synthetic-illustrative';
  readonly hgvs: string | null;
  readonly proteinHgvs: string | null;
  readonly legacyName: string | null;
  readonly numberingNote: string | null;
  readonly refAa: string;
  readonly altAa: string;
  readonly refAaName: string;
  readonly altAaName: string;
  readonly summary: string;
  readonly consequence: string;
  readonly confidence: string;
  /** Per-annotation honesty note from data/loci.json (SPEC §7.7). */
  readonly limitation: string;
}

export interface GenotypeView {
  readonly label: string;
  readonly bases: string;
  readonly protein: string;
  readonly polymerizationTendency: number;
  /** Curated genotype whose protein this matches, when one does. */
  readonly matchedGenotypeId: string | null;
  readonly tendencyBasis: string;
}

export interface DiffView {
  readonly refLabel: string;
  readonly altLabel: string;
  readonly rows: readonly DiffRow[];
  readonly changedCodons: readonly number[];
}

export interface CommitView {
  readonly oid: string;
  readonly short: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly message: string;
  readonly timestamp: number;
  readonly isMerge: boolean;
  readonly isRoot: boolean;
  /** Branch names whose tip is this commit. */
  readonly branches: readonly string[];
  readonly edit: EditView | null;
  readonly genotype: GenotypeView;
  readonly run: RunView | null;
  readonly status: NodeStatus;
  /** What this commit changed relative to its first parent. */
  readonly diffVsParent: DiffView | null;
  /** What this commit's genotype looks like against the reference allele. */
  readonly diffVsReference: DiffView;
}

export interface BranchView {
  readonly name: string;
  readonly tip: string;
  readonly shortTip: string;
  readonly isHead: boolean;
  readonly status: NodeStatus;
  readonly tipMessage: string;
  /** Commits on this branch not reachable from the head branch. */
  readonly ahead: number;
  readonly mergeBlockedReason: string | null;
}

export interface GraphView {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  readonly laneCount: number;
  readonly rowCount: number;
  readonly width: number;
  readonly height: number;
  readonly rowHeight: number;
  readonly laneWidth: number;
  /** Plain-text rendering, used as the graph's accessible alternative. */
  readonly description: readonly string[];
}

export interface ExonView {
  readonly index: number;
  readonly label: string;
  readonly codonStart: number;
  readonly codonEnd: number;
  readonly note: string;
  readonly modelled: boolean;
  readonly partiallyModelled: boolean;
}

export interface LocusView {
  readonly gene: string;
  readonly name: string;
  readonly chromosome: string;
  readonly note: string;
  readonly provenance: string;
  readonly referenceLabel: string;
  readonly referenceBases: string;
  readonly referenceProtein: string;
  readonly codonCount: number;
  /** Set when data/loci.json's own codonCount disagrees with its sequence. */
  readonly declaredCodonCount: number | null;
  readonly startCodon: number;
  readonly exons: readonly ExonView[];
  /** Last codon of the gene, from the annotation — includes unmodelled exons. */
  readonly totalCodons: number;
}

export interface SimulationView {
  readonly note: string;
  readonly seed: number;
  readonly cellCount: number;
  readonly defaultPO2: number;
  readonly capillaryConstriction: number;
  readonly pO2Min: number;
  readonly pO2Max: number;
  readonly pO2Unit: string;
  readonly pO2Label: string;
  readonly sicklingOnsetBelow: number;
}

export interface ScenarioView {
  readonly commits: readonly CommitView[];
  readonly branches: readonly BranchView[];
  readonly graph: GraphView;
  readonly locus: LocusView;
  readonly simulation: SimulationView;
  readonly headBranch: string;
  readonly disclaimer: string;
  /** Merges already applied, so the client can replay them on the next call. */
  readonly appliedMerges: readonly MergeRequest[];
  readonly signoffs: readonly SignoffRequest[];
}

export interface MergeRequest {
  readonly into: string;
  readonly from: string;
}

/**
 * A recorded human sign-off, as it travels from the client.
 *
 * There is deliberately **no `role` field**. The role that satisfies an
 * escalation is read server-side from the policy's own `signoffRole` for that
 * branch's run, so a client cannot name a role that clears the gate. Adding a
 * `role` here would reopen that hole (SPEC §7.5).
 */
export interface SignoffRequest {
  readonly branch: string;
  readonly by: string;
}

export interface ConflictView {
  readonly gene: string;
  readonly base: string | null;
  readonly ours: string | null;
  readonly theirs: string | null;
  readonly baseLabel: string;
  readonly oursLabel: string;
  readonly theirsLabel: string;
}

export type MergeOutcome =
  | {
      readonly kind: 'clean';
      readonly into: string;
      readonly from: string;
      readonly mergeOid: string;
      readonly short: string;
      /** True when both sides had already made the identical change. */
      readonly identical: boolean;
      readonly scenario: ScenarioView;
    }
  | {
      readonly kind: 'conflict';
      readonly into: string;
      readonly from: string;
      readonly baseOid: string | null;
      readonly conflicts: readonly ConflictView[];
    }
  | {
      readonly kind: 'blocked';
      readonly into: string;
      readonly from: string;
      readonly reason: string;
      readonly category: string;
      readonly verdict: RunVerdictView;
      readonly requiresSignoffBy: string | null;
    }
  | {
      readonly kind: 'error';
      readonly into: string;
      readonly from: string;
      readonly reason: string;
    };

/**
 * A red-team console entry carrying a full seven-agent run.
 *
 * Like every type here it has **no field for the request text** — only the
 * run's own output plus non-verbatim derived counts.
 */
export interface ConsoleRunView {
  readonly id: string;
  readonly at: number;
  readonly run: RunView;
  readonly tokenCount: number;
  readonly resolvedTargets: readonly string[];
  readonly plannedVariantLabel: string | null;
  readonly passedGate: boolean;
}
