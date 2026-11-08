import type { Consequence } from './types';

const THREE_TO_ONE: Readonly<Record<string, string>> = {
  Ala: 'A', Arg: 'R', Asn: 'N', Asp: 'D', Cys: 'C', Gln: 'Q', Glu: 'E', Gly: 'G', His: 'H', Ile: 'I',
  Leu: 'L', Lys: 'K', Met: 'M', Phe: 'F', Pro: 'P', Ser: 'S', Thr: 'T', Trp: 'W', Tyr: 'Y', Val: 'V',
  Ter: '*', Sec: 'U', Pyl: 'O', Xaa: 'X',
};

const ONE_TO_THREE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(THREE_TO_ONE).map(([three, one]) => [one, three]),
);

export function aaToOne(aa: string): string | null {
  if (aa.length === 1) return ONE_TO_THREE[aa.toUpperCase()] ? aa.toUpperCase() : null;
  const key = aa.charAt(0).toUpperCase() + aa.slice(1).toLowerCase();
  return THREE_TO_ONE[key] ?? null;
}

/**
 * `p.E7V` / `E7V` / `p.R213*` -> `p.Glu7Val` / `p.Arg213Ter`. Returns null for
 * anything that is not a plain one-letter substitution or frameshift.
 */
export function proteinToThreeLetter(change: string): string | null {
  const m = /^(?:p\.)?([A-Z])(\d+)([A-Z*]|fs)$/i.exec(change.trim());
  if (!m) return null;
  const ref = ONE_TO_THREE[m[1].toUpperCase()];
  if (!ref) return null;
  if (m[3].toLowerCase() === 'fs') return `p.${ref}${m[2]}fs`;
  const alt = ONE_TO_THREE[m[3].toUpperCase()];
  return alt ? `p.${ref}${m[2]}${alt}` : null;
}

export interface ParsedQuery {
  readonly gene: string | null;
  /** `c.` change as typed, without transcript. */
  readonly coding: string | null;
  /** `p.` change in three-letter form when convertible, else as typed. */
  readonly protein: string | null;
}

const GENE_TOKEN = /^[A-Za-z][A-Za-z0-9-]{1,15}$/;

/** Splits "BRCA1 c.5266dupC", "CFTR p.Phe508del", "TP53 R175H", "NM_000518.5:c.20A>T". */
export function parseVariantQuery(query: string): ParsedQuery {
  let gene: string | null = null;
  let coding: string | null = null;
  let protein: string | null = null;
  for (const raw of query.trim().split(/[\s,;]+/)) {
    const token = raw.replace(/^\(|\)$/g, '');
    const change = token.includes(':') ? token.slice(token.lastIndexOf(':') + 1) : token;
    if (/^c\.\S+$/i.test(change)) {
      coding = `c.${change.slice(2)}`;
    } else if (/^p\.\S+$/i.test(change)) {
      protein = proteinToThreeLetter(change) ?? `p.${change.slice(2).replace(/^\(|\)$/g, '')}`;
    } else if (/^[A-Z]\d+([A-Z*]|fs)$/.test(change) && proteinToThreeLetter(change)) {
      protein = proteinToThreeLetter(change);
    } else if (gene === null && !token.includes(':') && GENE_TOKEN.test(token) && !/^rs\d+$/i.test(token)) {
      gene = token.toUpperCase();
    }
  }
  return { gene, coding, protein };
}

/**
 * Canonical form for comparing two HGVS changes: no transcript prefix, lower
 * case, trailing deleted/duplicated bases dropped (`c.5266dupC` == `c.5266dup`),
 * frameshift detail dropped (`p.Gln1756Profs*74` == `p.Gln1756fs`).
 */
export function canonicalChange(hgvs: string): string {
  let s = hgvs.trim();
  if (s.includes(':')) s = s.slice(s.lastIndexOf(':') + 1);
  s = s.replace(/[()]/g, '').toLowerCase().replace(/\*/g, 'ter');
  s = s.replace(/(del|dup)[acgt]+$/, '$1');
  s = s.replace(/([a-z]{3})?fs.*$/, 'fs');
  return s;
}

const SEVERITY: readonly Consequence[] = [
  'frameshift',
  'stop_gained',
  'splice',
  'start_lost',
  'inframe_indel',
  'missense',
  'synonymous',
  'other',
  'unknown',
];

export function mostSevere(consequences: readonly Consequence[]): Consequence {
  if (consequences.length === 0) return 'unknown';
  return consequences.reduce((a, b) => (SEVERITY.indexOf(b) < SEVERITY.indexOf(a) ? b : a));
}

/** Maps one snpEff / VEP / CADD effect term (Sequence Ontology or legacy upper-case names). */
export function mapEffect(effect: string): Consequence {
  const e = effect.toLowerCase();
  if (e.includes('frameshift') || e.includes('frame_shift')) return 'frameshift';
  if (e.includes('stop_gained')) return 'stop_gained';
  if (e.includes('splice_acceptor') || e.includes('splice_donor') || e.includes('canonical_splice') || e.includes('splice_site_'))
    return 'splice';
  if (e.includes('start_lost')) return 'start_lost';
  if (e.includes('inframe') || e.includes('codon_insertion') || e.includes('codon_deletion')) return 'inframe_indel';
  if (e.includes('missense') || e.includes('non_synonymous')) return 'missense';
  if (e.includes('synonymous') || e === 'stop_retained_variant') return 'synonymous';
  return 'other';
}

/** Splits compound snpEff effects (`splice_region_variant&intron_variant`) and maps each. */
export function mapEffects(effects: readonly string[]): Consequence {
  return mostSevere(effects.flatMap((e) => e.split('&')).map((e) => mapEffect(e.trim())));
}

/**
 * Fallback when no annotator scored the variant (common for indels on GRCh38):
 * read the consequence off HGVS nomenclature. Returns null when undecidable.
 */
export function consequenceFromHgvs(protein: string | null, coding: string | null): Consequence | null {
  if (protein) {
    const p = protein.slice(protein.lastIndexOf(':') + 1).replace(/[()]/g, '');
    if (/fs/i.test(p)) return 'frameshift';
    if (/^p\.(Met1|M1)(?!\d)/.test(p) && !/=$/.test(p)) return 'start_lost';
    if (/(Ter|\*)\d*$/.test(p) && !/^p\.(Ter|\*)/.test(p)) return 'stop_gained';
    if (/(del|ins|dup)/i.test(p)) return 'inframe_indel';
    if (/=$/.test(p)) return 'synonymous';
    const sub = /^p\.([A-Z][a-z]{2}|[A-Z])\d+([A-Z][a-z]{2}|[A-Z])$/.exec(p);
    if (sub && aaToOne(sub[1]) !== aaToOne(sub[2])) return 'missense';
  }
  if (coding) {
    const c = coding.slice(coding.lastIndexOf(':') + 1);
    if (/^c\.\d+[+-][12](?!\d)/.test(c)) return 'splice';
    const len = indelLength(c);
    if (len !== null && /^c\.\d+(_\d+)?(del|dup|ins)/.test(c)) return len % 3 === 0 ? 'inframe_indel' : 'frameshift';
  }
  return null;
}

function indelLength(c: string): number | null {
  const ins = /ins([ACGT]+)$/i.exec(c);
  const range = /^c\.(\d+)_(\d+)(del|dup)/.exec(c);
  if (/delins/i.test(c)) return null;
  if (ins && !/del|dup/.test(c)) return ins[1].length;
  if (range) return Number(range[2]) - Number(range[1]) + 1;
  if (/^c\.\d+(del|dup)[ACGT]?$/i.test(c)) return 1;
  return null;
}
