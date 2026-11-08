/**
 * Deterministic variant-query extraction for the non-AI path and branch
 * naming. Returns a query the evidence service can resolve, or null.
 */

const RSID = /\brs\d{1,12}\b/i;
const GENOMIC = /\bchr(?:[0-9]{1,2}|X|Y|MT?):g\.[0-9_]+[A-Za-z0-9>_]*/i;
const GENE = '([A-Z][A-Z0-9]{1,9})';
const CODING = new RegExp(`\\b${GENE}[\\s:]+(c\\.[0-9_+*-]+[A-Za-z0-9>_]*)`);
const PROTEIN = new RegExp(`\\b${GENE}[\\s:]+(p\\.\\(?[A-Z][a-z]{0,2}\\d+[A-Za-z*]{1,3}\\)?)`);
const THREE_LETTER = new RegExp(`\\b${GENE}\\s+([A-Z][a-z]{2}\\d+(?:[A-Z][a-z]{2}|Ter|\\*))(?![A-Za-z0-9])`);
const ONE_LETTER = new RegExp(`\\b${GENE}\\s+([ACDEFGHIKLMNPQRSTVWY]\\d{1,5}[ACDEFGHIKLMNPQRSTVWYX*])(?![A-Za-z0-9])`);

/** Named variants a clinician says out loud instead of an identifier. */
const ALIASES: readonly { readonly pattern: RegExp; readonly query: string }[] = [
  { pattern: /\bsickle\b/i, query: 'rs334' },
];

export function extractVariantQuery(text: string): string | null {
  const rs = text.match(RSID);
  if (rs) return rs[0].toLowerCase();
  const g = text.match(GENOMIC);
  if (g) return g[0].replace(/^chr/i, 'chr');
  const c = text.match(CODING);
  if (c) return `${c[1]} ${c[2]}`;
  const p = text.match(PROTEIN);
  if (p) return `${p[1]} ${p[2].replace(/[()]/g, '')}`;
  const three = text.match(THREE_LETTER);
  if (three) return `${three[1]} p.${three[2]}`;
  const one = text.match(ONE_LETTER);
  if (one) return `${one[1]} p.${one[2]}`;
  for (const a of ALIASES) if (a.pattern.test(text)) return a.query;
  return null;
}
