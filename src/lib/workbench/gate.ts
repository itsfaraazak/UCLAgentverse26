import { FLAGGED_LOCI, screen, type ScreenResult } from '../safety/policy';
import type { GateData, RequestMode } from './types';

/**
 * Deterministic request gate. Runs before any model call and before the
 * request text is stored, so refused text never reaches the history.
 */

const EDIT_VERBS =
  /\b(correct(?:s|ed|ing|ion)?|repair(?:s|ed|ing)?|fix(?:es|ed|ing)?|revert(?:s|ed|ing)?|edit(?:s|ed|ing)?|knock[- ]?(?:out|outs|ed out|ing out)|disrupt(?:s|ed|ing|ion)?|introduc(?:e|es|ed|ing)|insert(?:s|ing)?|delet(?:e|es|ing)|silenc(?:e|es|ed|ing)|modif(?:y|ies|ied|ying|ication)|engineer(?:s|ed|ing)?|crispr|base[- ]edit(?:s|ed|ing)?|prime[- ]edit(?:s|ed|ing)?)\b/gi;

/** "Is that correct?" uses the adjective, not the verb. */
const ADJECTIVE_CORRECT = /\b(?:is|are|was|were|be|been|seems?|looks?|not|it's|that's|this|that|still)\s+(?:\w+\s+)?correct\b|\bcorrect\s*(?:\?|$)/i;

const GENE_TOKEN = /\b[A-Z][A-Z0-9]{1,9}\b/g;

const FLAGGED = new Set(FLAGGED_LOCI.map((l) => l.gene.toUpperCase()));

export const INTERPRETATION_REASON =
  'Interpreting an observed variant proposes no edit, so it is in scope for any gene.';

const ROLE_LABELS: Readonly<Record<string, string>> = {
  institutional_biosafety_committee: 'Institutional biosafety committee',
  principal_investigator: 'Principal investigator',
};

export function roleLabel(policyRole: string | undefined): string | null {
  if (policyRole === undefined) return null;
  return ROLE_LABELS[policyRole] ?? policyRole;
}

export function requestMode(text: string): RequestMode {
  const hits = text.match(EDIT_VERBS) ?? [];
  const verbs = hits.filter((h) => h.toLowerCase() !== 'correct' || !ADJECTIVE_CORRECT.test(text));
  return verbs.length > 0 ? 'edit' : 'interpret';
}

export function flaggedGenesIn(text: string): string[] {
  const tokens = text.match(GENE_TOKEN) ?? [];
  return [...new Set(tokens.filter((t) => FLAGGED.has(t)))];
}

function fromScreen(mode: RequestMode, r: ScreenResult): GateData {
  return {
    mode,
    verdict: r.verdict,
    category: r.category,
    reason: r.reason,
    requiresSignoff: r.requiresSignoff,
    signoffRole: roleLabel(r.signoffRole),
    flaggedGenes: [...r.flaggedGenes],
    redacted: r.redacted,
    requestDigest: r.requestDigest,
  };
}

/** Screen an edit at known targets (used for the request and for edit proposals). */
export function gateEdit(text: string, targets: readonly string[]): GateData {
  return fromScreen('edit', screen({ text, targets: [...new Set(targets.map((t) => t.toUpperCase()))] }));
}

/**
 * @param branchGenes genes already resolved on the branch, so "correct it"
 *   on an existing case is screened against that case's locus.
 */
export function gateRequest(text: string, branchGenes: readonly string[] = []): GateData {
  const mode = requestMode(text);
  if (mode === 'edit') {
    return gateEdit(text, [...flaggedGenesIn(text), ...branchGenes]);
  }
  const r = screen({ text, targets: [] });
  if (
    r.category === 'PATHOGEN_OR_TOXIN_ENHANCEMENT' ||
    r.category === 'CONSTRUCT_DESIGN_REQUEST' ||
    r.category === 'GERMLINE_HERITABLE'
  ) {
    return fromScreen('interpret', r);
  }
  return {
    mode: 'interpret',
    verdict: 'allow',
    category: 'VARIANT_INTERPRETATION',
    reason: INTERPRETATION_REASON,
    requiresSignoff: false,
    signoffRole: null,
    flaggedGenes: flaggedGenesIn(text),
    redacted: false,
    requestDigest: r.requestDigest,
  };
}

export function withheldText(digest: string): string {
  return `[withheld by policy - request digest ${digest}]`;
}

/** The text that may be stored for a screened request. */
export function storableText(text: string, gate: GateData): string {
  return gate.verdict === 'block' && gate.redacted ? withheldText(gate.requestDigest) : text;
}
