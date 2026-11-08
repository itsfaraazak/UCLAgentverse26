import rawLoci from '../../data/loci.json';
import type { Sequence, Variant, VariantKind } from './types';
import { applyVariant } from './variant';

export type Provenance = 'public-reference' | 'synthetic-illustrative';

export interface LocusExon {
  readonly index: number;
  readonly label: string;
  readonly codonStart: number;
  readonly codonEnd: number;
  readonly note: string;
}

export interface StructuralAnnotation {
  readonly refAa: string;
  readonly altAa: string;
  readonly refAaName: string;
  readonly altAaName: string;
  readonly summary: string;
  readonly consequence: string;
  readonly polymerizationTendency: number;
  readonly confidence: string;
  readonly limitation: string;
}

export interface CdsReference {
  readonly label: string;
  readonly startCodon: number;
  readonly codonCount: number;
  readonly bases: string;
  /**
   * Public database accession the sequence was taken from, when it came from
   * one. Absent for synthetic fixtures.
   */
  readonly accession?: string;
  /** 0-based offset of this CDS within that record's full molecule. */
  readonly cdsOffset?: number;
}

export interface LocusVariant extends Variant {
  readonly id: string;
  readonly provenance: Provenance;
  readonly hgvs?: string;
  readonly proteinHgvs?: string;
  readonly legacyName?: string;
  readonly numberingNote?: string;
  readonly structural: StructuralAnnotation;
}

export interface LocusGenotype {
  readonly id: string;
  readonly label: string;
  readonly appliedVariants: readonly string[];
  readonly polymerizationTendency: number;
}

export interface Locus {
  readonly gene: string;
  readonly provenance: Provenance;
  readonly name: string;
  readonly chromosome: string;
  readonly note: string;
  readonly cdsReference: CdsReference;
  readonly exons: readonly LocusExon[];
  readonly variants: readonly LocusVariant[];
  readonly genotypes: readonly LocusGenotype[];
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`loci.json: ${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Validates `refCodon` against the variant's `kind`, mirroring `applyVariant`
 * (SPEC.md §4.6 #15).
 *
 * An insertion has no reference codon to check, so its `refCodon` must be
 * empty; `applyVariant` throws on a non-empty one so nobody believes a check
 * happened that did not. Rejecting here means a malformed fixture fails at load
 * time rather than at apply time.
 *
 * `requireString`'s non-empty rule would otherwise make an insertion fixture
 * impossible to express, even though `kind: 'insertion'` is supported.
 */
function requireRefCodon(value: unknown, kind: VariantKind, field: string): string {
  if (kind === 'insertion') {
    if (value === undefined || value === '') return '';
    if (typeof value !== 'string') {
      throw new Error(`loci.json: ${field} must be a string when present`);
    }
    throw new Error(
      `loci.json: ${field} must be empty for an insertion — an insertion has no ` +
        `reference codon to verify (got ${JSON.stringify(value)})`,
    );
  }
  return requireCodon(value, field);
}

/**
 * A codon field is three DNA bases, and is checked for it here.
 *
 * `altCodon` is the field that needs this. Nothing downstream verifies it:
 * `applyVariant` matches `refCodon` against the sequence and so fails closed on
 * a malformed one, but it splices `altCodon` into the codon list unchecked. A
 * two-base `altCodon` therefore shortens the sequence by one base and shifts
 * the reading frame of every codon after it — silently, since the result is
 * still a valid string of bases and `translate` happily reads the new frame.
 * That is the §4.6 #13 failure mode (silent truncation in a tool whose pitch is
 * auditability), so it is refused at the boundary with the offending value
 * named, rather than left to produce a plausible wrong protein.
 *
 * `refCodon` gets the same check. It is self-checking against the sequence, so
 * this only moves the failure from a confusing `refCodon mismatch` at apply
 * time to a fixture error at load time, naming the real problem.
 *
 * Deliberately not ratifying what a *deletion*'s `altCodon` must be: nothing
 * replaces the deleted codon, so `applyVariant` ignores the field entirely.
 * Whether it should then be required empty — mirroring §4.6 #15's rule for an
 * insertion's `refCodon` — is unspecified, and no fixture reaches it (SPEC §4.8
 * records the missing indel fixture as a follow-up). `requireString`'s
 * non-empty rule is left in place for it rather than inventing policy here.
 */
function requireCodon(value: unknown, field: string): string {
  const codon = requireString(value, field).toUpperCase();
  if (!/^[ACGT]{3}$/.test(codon)) {
    throw new Error(
      `loci.json: ${field} must be three DNA bases from A, C, G, T — got ` +
        `${JSON.stringify(codon)}`,
    );
  }
  return codon;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`loci.json: ${field} must be a finite number`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function requireProvenance(value: unknown, field: string): Provenance {
  if (value === 'public-reference' || value === 'synthetic-illustrative') {
    return value;
  }
  throw new Error(`loci.json: ${field} must be a labelled provenance`);
}

function requireKind(value: unknown, field: string): VariantKind {
  if (value === 'substitution' || value === 'deletion' || value === 'insertion') {
    return value;
  }
  throw new Error(`loci.json: ${field} is not a supported variant kind`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStructural(raw: unknown, field: string): StructuralAnnotation {
  if (!isRecord(raw)) {
    throw new Error(`loci.json: ${field} must be an object`);
  }
  return {
    refAa: requireString(raw.refAa, `${field}.refAa`),
    altAa: requireString(raw.altAa, `${field}.altAa`),
    refAaName: requireString(raw.refAaName, `${field}.refAaName`),
    altAaName: requireString(raw.altAaName, `${field}.altAaName`),
    summary: requireString(raw.summary, `${field}.summary`),
    consequence: requireString(raw.consequence, `${field}.consequence`),
    polymerizationTendency: requireNumber(
      raw.polymerizationTendency,
      `${field}.polymerizationTendency`,
    ),
    confidence: requireString(raw.confidence, `${field}.confidence`),
    limitation: requireString(raw.limitation, `${field}.limitation`),
  };
}

/**
 * Exported so the fixture boundary's rules are assertable on inputs the
 * shipped file does not contain, as `parseAcmgRecord` is. The bundled fixture
 * is clean, so without this the refusals below are unreachable from a test and
 * the boundary is only claimed rather than checked.
 */
export function parseVariantRecord(
  raw: unknown,
  gene: string,
  field = 'variant',
): LocusVariant {
  return parseVariant(raw, gene, field);
}

function parseVariant(raw: unknown, gene: string, field: string): LocusVariant {
  if (!isRecord(raw)) {
    throw new Error(`loci.json: ${field} must be an object`);
  }
  // `kind` is resolved first because it decides how `refCodon` is validated.
  const kind = requireKind(raw.kind, `${field}.kind`);
  const variant: LocusVariant = {
    id: requireString(raw.id, `${field}.id`),
    provenance: requireProvenance(raw.provenance, `${field}.provenance`),
    gene,
    codonIndex: requireNumber(raw.codonIndex, `${field}.codonIndex`),
    refCodon: requireRefCodon(raw.refCodon, kind, `${field}.refCodon`),
    altCodon:
      kind === 'deletion'
        ? requireString(raw.altCodon, `${field}.altCodon`).toUpperCase()
        : requireCodon(raw.altCodon, `${field}.altCodon`),
    kind,
    label: requireString(raw.label, `${field}.label`),
    structural: parseStructural(raw.structural, `${field}.structural`),
  };
  const hgvs = optionalString(raw.hgvs);
  const proteinHgvs = optionalString(raw.proteinHgvs);
  const legacyName = optionalString(raw.legacyName);
  const numberingNote = optionalString(raw.numberingNote);
  return {
    ...variant,
    ...(hgvs === undefined ? {} : { hgvs }),
    ...(proteinHgvs === undefined ? {} : { proteinHgvs }),
    ...(legacyName === undefined ? {} : { legacyName }),
    ...(numberingNote === undefined ? {} : { numberingNote }),
  };
}

function parseGenotype(raw: unknown, field: string): LocusGenotype {
  if (!isRecord(raw)) {
    throw new Error(`loci.json: ${field} must be an object`);
  }
  if (!Array.isArray(raw.appliedVariants)) {
    throw new Error(`loci.json: ${field}.appliedVariants must be an array`);
  }
  return {
    id: requireString(raw.id, `${field}.id`),
    label: requireString(raw.label, `${field}.label`),
    appliedVariants: raw.appliedVariants.map((id, i) =>
      requireString(id, `${field}.appliedVariants[${i}]`),
    ),
    polymerizationTendency: requireNumber(
      raw.polymerizationTendency,
      `${field}.polymerizationTendency`,
    ),
  };
}

function parseExon(raw: unknown, field: string): LocusExon {
  if (!isRecord(raw)) {
    throw new Error(`loci.json: ${field} must be an object`);
  }
  return {
    index: requireNumber(raw.index, `${field}.index`),
    label: requireString(raw.label, `${field}.label`),
    codonStart: requireNumber(raw.codonStart, `${field}.codonStart`),
    codonEnd: requireNumber(raw.codonEnd, `${field}.codonEnd`),
    note: requireString(raw.note, `${field}.note`),
  };
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * `codonCount` is redundant with `bases` by construction, which is exactly why
 * it is cross-checked: a fixture whose declared length disagrees with its
 * sequence is the kind of drift that silently invalidates every codon
 * coordinate downstream. Fail at load, not at render.
 */
function parseCdsReference(raw: Record<string, unknown>, field: string): CdsReference {
  const bases = requireString(raw.bases, `${field}.bases`).toUpperCase();
  const codonCount = requireNumber(raw.codonCount, `${field}.codonCount`);
  if (bases.length % 3 !== 0) {
    throw new Error(
      `loci.json: ${field}.bases has length ${bases.length}, which is not a whole number of codons`,
    );
  }
  if (bases.length / 3 !== codonCount) {
    throw new Error(
      `loci.json: ${field}.codonCount is ${codonCount} but ${field}.bases holds ` +
        `${bases.length / 3} codons (${bases.length} nt)`,
    );
  }
  const accession = optionalString(raw.accession);
  const cdsOffset = optionalNumber(raw.cdsOffset);
  return {
    label: requireString(raw.label, `${field}.label`),
    startCodon: requireNumber(raw.startCodon, `${field}.startCodon`),
    codonCount,
    bases,
    ...(accession === undefined ? {} : { accession }),
    ...(cdsOffset === undefined ? {} : { cdsOffset }),
  };
}

function parseLocus(raw: unknown, field: string): Locus {
  if (!isRecord(raw)) {
    throw new Error(`loci.json: ${field} must be an object`);
  }
  const gene = requireString(raw.gene, `${field}.gene`);
  if (!isRecord(raw.cdsReference)) {
    throw new Error(`loci.json: ${field}.cdsReference must be an object`);
  }
  if (!Array.isArray(raw.exons) || !Array.isArray(raw.variants) || !Array.isArray(raw.genotypes)) {
    throw new Error(`loci.json: ${field} is missing exons, variants, or genotypes`);
  }
  return {
    gene,
    provenance: requireProvenance(raw.provenance, `${field}.provenance`),
    name: requireString(raw.name, `${field}.name`),
    chromosome: requireString(raw.chromosome, `${field}.chromosome`),
    note: requireString(raw.note, `${field}.note`),
    cdsReference: parseCdsReference(raw.cdsReference, `${field}.cdsReference`),
    exons: raw.exons.map((exon, i) => parseExon(exon, `${field}.exons[${i}]`)),
    variants: raw.variants.map((variant, i) =>
      parseVariant(variant, gene, `${field}.variants[${i}]`),
    ),
    genotypes: raw.genotypes.map((genotype, i) =>
      parseGenotype(genotype, `${field}.genotypes[${i}]`),
    ),
  };
}

function parseLociFile(raw: unknown): readonly Locus[] {
  if (!isRecord(raw) || !Array.isArray(raw.loci)) {
    throw new Error('loci.json: missing loci array');
  }
  return Object.freeze(
    raw.loci.map((locus, i) => parseLocus(locus, `loci[${i}]`)),
  );
}

const LOCI: readonly Locus[] = parseLociFile(rawLoci);

function parseDisclaimer(raw: unknown): string {
  if (!isRecord(raw)) throw new Error('loci.json: not an object');
  const value = raw._disclaimer;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('loci.json: _disclaimer must be a non-empty string');
  }
  return value;
}

/**
 * The fixture's own statement of what it is and is not.
 *
 * SPEC §7.7 requires the UI to state the model's limits where the numbers
 * appear, and §7.6 requires every fixture to carry its provenance. The text
 * is authored in `loci.json` beside the data it describes, so it is loaded
 * from there and rendered verbatim rather than paraphrased per surface — a
 * paraphrase is how a disclosure quietly weakens.
 */
export const FIXTURE_DISCLAIMER: string = parseDisclaimer(rawLoci);

const LOCI_BY_GENE: ReadonlyMap<string, Locus> = new Map(
  LOCI.map((locus) => [locus.gene.toUpperCase(), locus]),
);

/** All curated loci. Frozen after parse. */
export function loadLoci(): readonly Locus[] {
  return LOCI;
}

export function getLocus(gene: string): Locus | undefined {
  return LOCI_BY_GENE.get(gene.trim().toUpperCase());
}

export function getLocusVariant(gene: string, variantId: string): LocusVariant | undefined {
  const locus = getLocus(gene);
  if (locus === undefined) return undefined;
  return locus.variants.find((v) => v.id === variantId);
}

export function getGenotype(gene: string, genotypeId: string): LocusGenotype | undefined {
  const locus = getLocus(gene);
  if (locus === undefined) return undefined;
  return locus.genotypes.find((g) => g.id === genotypeId);
}

export function referenceSequence(locus: Locus): Sequence {
  return {
    bases: locus.cdsReference.bases,
    label: locus.cdsReference.label,
  };
}

export function variantById(locus: Locus, variantId: string): LocusVariant | undefined {
  return locus.variants.find((v) => v.id === variantId);
}

/** Applies a genotype's variant list, in order, to the locus reference allele. */
export function sequenceForGenotype(locus: Locus, genotype: LocusGenotype): Sequence {
  let seq = referenceSequence(locus);
  for (const id of genotype.appliedVariants) {
    const variant = variantById(locus, id);
    if (variant === undefined) {
      throw new Error(`unknown variant '${id}' on locus ${locus.gene}`);
    }
    seq = applyVariant(seq, variant);
  }
  return { bases: seq.bases, label: genotype.label };
}
