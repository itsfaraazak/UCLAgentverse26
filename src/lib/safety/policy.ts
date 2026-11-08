/**
 * SigmaFold — biosafety screening policy.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS THE SAFETY BOUNDARY. See SPEC.md §7.
 *
 * Agents working on this repository must NOT:
 *   - add or widen policy categories,
 *   - downgrade a verdict (e.g. 'block' → 'escalate' → 'allow'),
 *   - remove entries from FLAGGED_LOCI,
 *   - make the gate bypassable or run it later in the pipeline,
 *   - cause refused user input to be stored, logged, or rendered verbatim.
 *
 * If you believe the policy is wrong, say so in your report. Do not edit it.
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Design notes, stated honestly:
 *
 * This is a *deterministic, keyword-and-registry* screen, not a trained
 * classifier and not a substitute for institutional biosafety review. It is
 * deliberately simple so that a reviewer can read it and re-derive every
 * verdict by hand — that auditability is the point of the demo. Its known
 * weakness is the usual one for lexical screens: it over-blocks on innocent
 * phrasing and can be evaded by paraphrase. A real deployment would put this
 * in front of a human biosafety officer, not in place of one.
 *
 * The screen operates on *intent category*, never on construct content. This
 * module contains no guide RNA sequences, no primers, no vectors, no
 * protocols, and no pathogen or toxin target lists — by design. For refused
 * requests it records a category label and a digest, never the request text.
 */

import { createHash } from 'node:crypto';

/** What the pipeline is permitted to do with a request. */
export type Verdict = 'allow' | 'escalate' | 'block';

export type PolicyCategory =
  /** In scope: a somatic, therapeutic edit at a curated locus. */
  | 'THERAPEUTIC_SOMATIC'
  /** Target is a tumour suppressor; disruption carries oncogenic risk. */
  | 'TUMOUR_SUPPRESSOR_DISRUPTION'
  /** Heritable / germline / embryo modification. */
  | 'GERMLINE_HERITABLE'
  /** Several simultaneous targets with no stated therapeutic rationale. */
  | 'MULTIPLEX_UNJUSTIFIED'
  /** Asks for actionable wet-lab construct design. Out of scope by policy. */
  | 'CONSTRUCT_DESIGN_REQUEST'
  /** Enhancement of a pathogen or a toxin. Hard refusal. */
  | 'PATHOGEN_OR_TOXIN_ENHANCEMENT'
  /** Not a genome-edit proposal this tool models. */
  | 'OUT_OF_SCOPE';

export interface PolicyRule {
  readonly category: PolicyCategory;
  readonly verdict: Verdict;
  /**
   * Generic, request-independent explanation. Must never be templated with
   * user input — that is what keeps refused text out of the UI and the logs.
   */
  readonly reason: string;
  readonly requiresSignoff: boolean;
  /** Role that must sign off, when `requiresSignoff`. */
  readonly signoffRole?: string;
}

export const POLICY: Readonly<Record<PolicyCategory, PolicyRule>> = Object.freeze({
  THERAPEUTIC_SOMATIC: {
    category: 'THERAPEUTIC_SOMATIC',
    verdict: 'allow',
    reason:
      'Somatic edit at a curated therapeutic locus. In scope for simulation; ' +
      'no construct design is produced.',
    requiresSignoff: false,
  },
  TUMOUR_SUPPRESSOR_DISRUPTION: {
    category: 'TUMOUR_SUPPRESSOR_DISRUPTION',
    verdict: 'block',
    reason:
      'Target is on the flagged tumour-suppressor registry. Disrupting a ' +
      'tumour suppressor carries oncogenic risk and is refused by policy, ' +
      'independent of the stated purpose.',
    requiresSignoff: false,
  },
  GERMLINE_HERITABLE: {
    category: 'GERMLINE_HERITABLE',
    verdict: 'escalate',
    reason:
      'Request implies heritable modification. Heritable edits are outside ' +
      'what this tool may clear automatically and require named human review.',
    requiresSignoff: true,
    signoffRole: 'institutional_biosafety_committee',
  },
  MULTIPLEX_UNJUSTIFIED: {
    category: 'MULTIPLEX_UNJUSTIFIED',
    verdict: 'escalate',
    reason:
      'Multiple simultaneous targets with no stated therapeutic rationale. ' +
      'Compound edits multiply off-target and interaction risk, so they are ' +
      'held for human review rather than auto-cleared.',
    requiresSignoff: true,
    signoffRole: 'principal_investigator',
  },
  CONSTRUCT_DESIGN_REQUEST: {
    category: 'CONSTRUCT_DESIGN_REQUEST',
    verdict: 'block',
    reason:
      'Request asks for actionable laboratory construct design (for example ' +
      'guide, primer, vector or protocol detail). This tool models edits at ' +
      'the sequence-diff level only and never produces wet-lab constructs.',
    requiresSignoff: false,
  },
  PATHOGEN_OR_TOXIN_ENHANCEMENT: {
    category: 'PATHOGEN_OR_TOXIN_ENHANCEMENT',
    verdict: 'block',
    reason:
      'Request falls in a prohibited category: enhancement of a pathogen or ' +
      'a toxin. Refused. The request text is not retained.',
    requiresSignoff: false,
  },
  OUT_OF_SCOPE: {
    category: 'OUT_OF_SCOPE',
    verdict: 'block',
    reason:
      'Not a genome-edit proposal this tool models. No curated target locus ' +
      'could be resolved from the request.',
    requiresSignoff: false,
  },
});

/**
 * Loci this prototype will reason about, and why each is treated as it is.
 * Every entry is public textbook knowledge about gene *function* — there are
 * deliberately no sequences, coordinates or construct details here.
 */
export interface FlaggedLocus {
  readonly gene: string;
  readonly classification:
    | 'therapeutic_target'
    | 'tumour_suppressor'
    | 'germline_sensitive';
  readonly note: string;
}

export const FLAGGED_LOCI: readonly FlaggedLocus[] = Object.freeze([
  {
    gene: 'HBB',
    classification: 'therapeutic_target',
    note:
      'Beta-globin. The worked example in this prototype. Somatic edits here ' +
      'are the in-scope therapeutic case.',
  },
  {
    gene: 'TP53',
    classification: 'tumour_suppressor',
    note:
      'Canonical tumour suppressor ("guardian of the genome"). Loss of ' +
      'function is implicated across a very wide range of cancers.',
  },
  { gene: 'RB1', classification: 'tumour_suppressor', note: 'Retinoblastoma tumour suppressor; cell-cycle checkpoint control.' },
  { gene: 'BRCA1', classification: 'tumour_suppressor', note: 'Homologous-recombination DNA repair; loss raises cancer risk.' },
  { gene: 'BRCA2', classification: 'tumour_suppressor', note: 'Homologous-recombination DNA repair; loss raises cancer risk.' },
  { gene: 'PTEN', classification: 'tumour_suppressor', note: 'Negative regulator of the PI3K/AKT growth pathway.' },
  { gene: 'APC', classification: 'tumour_suppressor', note: 'Wnt-pathway tumour suppressor; colorectal cancer predisposition.' },
  {
    gene: 'CCR5',
    classification: 'germline_sensitive',
    note:
      'Chemokine receptor. Flagged because of the documented 2018 germline ' +
      'editing incident; somatic research framing still escalates here.',
  },
]);

const BY_GENE: ReadonlyMap<string, FlaggedLocus> = new Map(
  FLAGGED_LOCI.map((l) => [l.gene.toUpperCase(), l]),
);

export function lookupLocus(gene: string): FlaggedLocus | undefined {
  return BY_GENE.get(gene.trim().toUpperCase());
}

/**
 * Category cues. These are intentionally *generic category words*: this file
 * must not become a target list, so it names the kind of thing being asked
 * for and never a specific agent, organism or construct.
 */
const CUES = Object.freeze({
  pathogenOrToxin: [
    'toxin',
    'bioweapon',
    'biological weapon',
    'weaponi', // weaponise / weaponize
    'virulence',
    'pathogenicity',
    'gain of function',
    'gain-of-function',
    'more lethal',
    'more transmissible',
    'increase transmissibility',
    'evade vaccine',
    'vaccine escape',
    'immune escape',
  ],
  constructDesign: [
    'guide rna',
    'grna',
    'sgrna',
    'crrna',
    'spacer sequence',
    'primer',
    'plasmid',
    'vector construct',
    'delivery vector',
    'protocol',
    'wet lab',
    'wet-lab',
    'transfection',
    'electroporation',
    'design a guide',
    'order the oligo',
    'oligo',
  ],
  germline: [
    'germline',
    'heritable',
    'embryo',
    'zygote',
    'inherit',
    'gamete',
    'sperm',
    'oocyte',
    'future generations',
  ],
  rationale: [
    'because',
    'in order to',
    'to treat',
    'to correct',
    'to repair',
    'rationale',
    'therapeutic',
    'indication',
  ],
});

function hasAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/** A one-way digest, so a refused request is auditable without being stored. */
export function digestRequest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

export interface ScreenInput {
  /** Free-text request, e.g. from the red-team console. */
  readonly text: string;
  /** Gene symbols the planner resolved, if any. */
  readonly targets?: readonly string[];
}

export interface ScreenResult {
  readonly category: PolicyCategory;
  readonly verdict: Verdict;
  readonly reason: string;
  readonly requiresSignoff: boolean;
  readonly signoffRole?: string;
  /** Gene symbols that triggered a locus-based decision. */
  readonly flaggedGenes: readonly string[];
  /**
   * sha256 prefix of the request. Present for every result so the audit trail
   * can reference a request without retaining it.
   */
  readonly requestDigest: string;
  /**
   * True when policy forbids echoing the request back to the user or the log.
   * The UI must honour this: render the category and reason only.
   */
  readonly redacted: boolean;
}

/**
 * Screen a request. Order matters: the most serious categories are tested
 * first so that a request which is several bad things at once is reported as
 * the most serious one.
 *
 * Pure and synchronous — no network, no I/O, no model call.
 */
export function screen(input: ScreenInput): ScreenResult {
  const text = input.text.toLowerCase();
  const digest = digestRequest(input.text);
  const targets = (input.targets ?? []).map((g) => g.trim().toUpperCase()).filter(Boolean);

  const build = (
    category: PolicyCategory,
    flaggedGenes: readonly string[] = [],
  ): ScreenResult => {
    const rule = POLICY[category];
    return {
      category: rule.category,
      verdict: rule.verdict,
      reason: rule.reason,
      requiresSignoff: rule.requiresSignoff,
      signoffRole: rule.signoffRole,
      flaggedGenes,
      requestDigest: digest,
      // Anything we refuse outright is never echoed back.
      redacted: rule.verdict === 'block',
    };
  };

  // 1. Hard refusal: pathogen or toxin enhancement.
  if (hasAny(text, CUES.pathogenOrToxin)) {
    return build('PATHOGEN_OR_TOXIN_ENHANCEMENT');
  }

  // 2. Hard refusal: actionable construct design is out of scope by policy.
  if (hasAny(text, CUES.constructDesign)) {
    return build('CONSTRUCT_DESIGN_REQUEST');
  }

  // 3. Flagged loci. Tumour suppressors are refused outright.
  const resolved = targets.map(lookupLocus).filter((l): l is FlaggedLocus => !!l);
  const suppressors = resolved.filter((l) => l.classification === 'tumour_suppressor');
  if (suppressors.length > 0) {
    return build(
      'TUMOUR_SUPPRESSOR_DISRUPTION',
      suppressors.map((l) => l.gene),
    );
  }

  // 4. Heritable modification: escalate to a human.
  const germlineSensitive = resolved.filter((l) => l.classification === 'germline_sensitive');
  if (hasAny(text, CUES.germline) || germlineSensitive.length > 0) {
    return build('GERMLINE_HERITABLE', germlineSensitive.map((l) => l.gene));
  }

  // 5. Compound edits with no stated reason: escalate.
  if (targets.length > 1 && !hasAny(text, CUES.rationale)) {
    return build('MULTIPLEX_UNJUSTIFIED', targets);
  }

  // 6. In scope only if we resolved a curated therapeutic target.
  const therapeutic = resolved.filter((l) => l.classification === 'therapeutic_target');
  if (therapeutic.length > 0) {
    return build('THERAPEUTIC_SOMATIC', therapeutic.map((l) => l.gene));
  }

  return build('OUT_OF_SCOPE', targets);
}

/** Convenience: may the pipeline continue past the gate? */
export function passesGate(r: ScreenResult): boolean {
  return r.verdict === 'allow';
}
