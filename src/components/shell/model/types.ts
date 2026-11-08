/**
 * Serializable view models passed from the server tree to the client shell.
 *
 * Why these exist at all: `lib/vcs`, `lib/agents` and `lib/safety` all reach
 * `node:crypto` (content-addressed oids, delta ids, request digests), so none
 * of them can run in the browser. The shell therefore resolves every value on
 * the server and ships plain data across the boundary.
 *
 * Nothing in this file holds a default, a sample or a placeholder. Every field
 * is populated by a module call in `model/workspace.ts` or by a server action
 * in `src/app/actions.ts`.
 */

import type { DiffRow, Sequence, Variant } from '@/lib/genome';
import type { CheckRunStatus } from '@/lib/merge-gate';
import type { SimMetrics } from '@/lib/cellsim';
import type { DeltaKind } from '@/lib/agents';
import type { PolicyCategory, Verdict } from '@/lib/safety/policy';

/** A gene-track exon, straight off the locus fixture. */
export interface ExonView {
  readonly index: number;
  readonly label: string;
  readonly codonStart: number;
  readonly codonEnd: number;
  readonly note: string;
  /** True when this exon lies inside the modelled CDS window. */
  readonly modelled: boolean;
}

export interface LocusView {
  readonly gene: string;
  readonly name: string;
  readonly chromosome: string;
  readonly provenance: string;
  readonly note: string;
  readonly reference: SequenceView;
  readonly codonCount: number;
  readonly startCodon: number;
  readonly exons: readonly ExonView[];
}

export interface SequenceView {
  readonly bases: string;
  readonly label: string;
  /** Frame-0 translation, stop character included (SPEC §4.5 #1). */
  readonly protein: string;
}

/** The edit a commit introduces, flattened for rendering. */
export interface EditView {
  readonly gene: string;
  readonly codonIndex: number;
  readonly refCodon: string;
  readonly altCodon: string;
  readonly kind: Variant['kind'];
  readonly label: string;
  readonly variantId: string | null;
  readonly hgvs: string | null;
  readonly proteinHgvs: string | null;
  readonly legacyName: string | null;
  readonly numberingNote: string | null;
  readonly refAa: string | null;
  readonly altAa: string | null;
}

export interface CommitView {
  readonly oid: string;
  readonly short: string;
  readonly author: string;
  readonly message: string;
  readonly timestamp: number;
  readonly parents: readonly string[];
  readonly edit: EditView | null;
}

export interface CheckRunView {
  readonly id: string;
  readonly commit: string;
  readonly status: CheckRunStatus;
  readonly requiresSignoff: boolean;
  readonly signoffRole: string | null;
  readonly signedOffBy: string | null;
  readonly reasons: readonly string[];
}

/** One row of the agent run log. Index is the fixed pipeline position, 1–7. */
export interface AgentStepView {
  readonly position: number;
  readonly agent: string;
  readonly role: string;
  readonly kind: DeltaKind | null;
  readonly deltaId: string | null;
  readonly createdAt: number | null;
  readonly outcome: 'passed' | 'escalated' | 'blocked' | 'not-run';
  readonly headline: string;
  readonly detail: readonly DetailRow[];
}

export interface DetailRow {
  readonly label: string;
  readonly value: string;
  /** Render the value with `.seq` — nucleotide or amino-acid text. */
  readonly sequence?: boolean;
}

export interface MeasuredMetricsView {
  readonly highPO2: SimMetrics | null;
  readonly lowPO2: SimMetrics | null;
  readonly referenceLowPO2: SimMetrics | null;
}

/** A completed pipeline run, as the agent console renders it. */
export interface RunView {
  readonly branch: string;
  readonly commit: string;
  /** The request the run screened. Derived in `model/derive.ts` and shown. */
  readonly request: string;
  readonly requestDigest: string;
  readonly blocked: boolean;
  readonly escalated: boolean;
  readonly passed: boolean;
  readonly mergeAllowed: boolean;
  readonly requiresSignoff: boolean;
  readonly signoffRole: string | null;
  readonly deltaCount: number;
  readonly headId: string;
  readonly steps: readonly AgentStepView[];
  readonly measured: MeasuredMetricsView;
  readonly check: CheckRunView;
  /** Verifier disagreement flags — the reason this is not a rubber stamp. */
  readonly disagreedWithAssay: boolean;
  readonly disagreedWithStructural: boolean;
  readonly assayLimitation: string;
}

export interface BranchView {
  readonly name: string;
  readonly head: string;
  readonly shortHead: string;
  readonly commitCount: number;
  readonly isDefault: boolean;
  /** Where the branch came from in `data/loci.json`. */
  readonly origin: string;
  readonly genotypeId: string | null;
  readonly genotypeLabel: string | null;
  readonly polymerizationTendency: number | null;
  readonly tipEdit: EditView | null;
  readonly sequence: SequenceView;
  /** The request a check run would screen, or null when there is no edit. */
  readonly request: string | null;
  readonly commits: readonly CommitView[];
  /**
   * The branch's tip check run, or `null` for a line that proposes no edit.
   *
   * `main` holds the imported reference and introduces nothing, so there is
   * genuinely nothing for the pipeline to screen. Reporting null rather than
   * synthesising a run matters: `IntentAgent` would parse no operation out of
   * a "describe the reference" request, and `planEdit` would then fall through
   * to its default — the *repair* plan — which would show the reference line a
   * check run for an edit it does not contain.
   */
  readonly run: RunView | null;
}

/**
 * A branch the user created, as an instruction to replay rather than a record
 * of one.
 *
 * The server holds no session state: it rebuilds the repository from
 * `data/loci.json` on every call, which is only sound because `lib/vcs` oids
 * are deterministic. A created branch therefore cannot live on the server
 * between requests. Instead the client keeps the list of specs and re-sends
 * it, and the server replays each one with `Repo.branch()` and a real
 * `applyVariant` commit. The branch is genuinely in the repository for the
 * duration of the request that needs it, and replaying the same specs
 * reproduces the same oids, so short hashes stay stable across requests.
 */
export interface BranchSpec {
  readonly name: string;
  /** The branch whose head the new line starts from. */
  readonly from: string;
  /** A curated variant id from `data/loci.json`, applied as its first edit. */
  readonly variantId: string;
}

export type MergeDecisionView =
  | { readonly kind: 'allowed'; readonly oid: string; readonly short: string }
  | {
      readonly kind: 'content-conflict';
      readonly conflicts: readonly {
        readonly gene: string;
        readonly base: string | null;
        readonly ours: string | null;
        readonly theirs: string | null;
      }[];
    }
  | {
      readonly kind: 'check-failed';
      readonly reasons: readonly string[];
      readonly blocking: readonly CheckRunView[];
    }
  | {
      readonly kind: 'awaiting-signoff';
      readonly signoffRole: string;
      readonly blocking: readonly CheckRunView[];
    }
  | { readonly kind: 'check-missing'; readonly commits: readonly string[] };

export interface MergeProposalView {
  /** Merge `incoming` into `into`. */
  readonly into: string;
  readonly incoming: string;
  readonly mergeBase: string | null;
  readonly mergeBaseShort: string | null;
  readonly introduced: readonly CommitView[];
  readonly decision: MergeDecisionView;
  /** Signatory names already recorded in this session, for the sign-off UI. */
  readonly signedOff: readonly string[];
}

export interface DiffView {
  readonly ref: SequenceView;
  readonly alt: SequenceView;
  readonly rows: readonly DiffRow[];
  readonly changedRows: readonly number[];
  /** First changed alignment row, or null when the sequences are identical. */
  readonly focusRow: number | null;
  /** Stated limitation on indel coordinates (SPEC §4.5 #2). */
  readonly coordinateNote: string;
}

/** The result of screening free text. Never carries refused input. */
export interface ScreenView {
  readonly category: PolicyCategory;
  readonly verdict: Verdict;
  readonly reason: string;
  readonly requiresSignoff: boolean;
  readonly signoffRole: string | null;
  readonly flaggedGenes: readonly string[];
  readonly requestDigest: string;
  readonly redacted: boolean;
  /**
   * The request text, echoed back **only** when policy permits it. `null` for
   * every `redacted` verdict — the field is nulled on the server, so a
   * block-class request cannot reach the client at all (SPEC §7.3).
   */
  readonly echo: string | null;
  /** Logical sequence number within the console session. */
  readonly seq: number;
  /** Set when the screen also produced a full pipeline run. */
  readonly run: RunView | null;
}

export interface SimulationDefaultsView {
  readonly seed: number;
  readonly cellCount: number;
  readonly pO2: number;
  readonly capillaryConstriction: number;
  readonly pO2Min: number;
  readonly pO2Max: number;
  readonly assayLimitation: string;
}

/** Everything the client shell needs for a first paint. */
export interface WorkspaceView {
  readonly locus: LocusView;
  readonly branches: readonly BranchView[];
  readonly defaultBranch: string;
  /**
   * Every curated variant in the locus, offered as the edit a newly created
   * branch applies. Derived from the fixture, so the picker gains an entry
   * when `data/loci.json` does and cannot offer an edit the planner has no
   * annotation for.
   */
  readonly variants: readonly EditView[];
  readonly agentOrder: readonly string[];
  readonly simulation: SimulationDefaultsView;
  readonly fixtureDisclaimer: string;
}

export type { DiffRow, Sequence, SimMetrics };
