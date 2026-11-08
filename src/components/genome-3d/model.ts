import {
  applyVariant,
  diffSequences,
  getLocus,
  referenceSequence,
  translate,
  variantById,
  type DiffRow,
  type Locus,
  type LocusVariant,
  type Sequence,
  type StructuralAnnotation,
} from '@/lib/genome';

/**
 * The data layer for the 3D genome view.
 *
 * Everything the renderer draws is derived here from `lib/genome` — the loci
 * loader, `diffSequences`, `translate` — and nothing is invented. The engine
 * reads `segments` and never looks at `loci.json` itself, which keeps the
 * Three.js code free of domain knowledge and lets the whole data layer be
 * unit-tested in a plain node environment.
 *
 * Two honesty rules are encoded in these types rather than left to the UI:
 *
 *  1. `loci.json` annotates HBB's exons out to codon 147, but only the first
 *     31 codons carry real sequence. Codons past the modelled region are
 *     emitted with `status: 'unsequenced'` and `refCodon: null`, so the view
 *     can draw the locus at its true extent without fabricating bases. The
 *     gene track already greys this region for context; we do the same in 3D.
 *
 *  2. `DiffRow.codonIndex` is an *alignment row*, not a CDS coordinate, once
 *     an indel has shifted the two sequences apart (SPEC §4.5 #2). When the
 *     diff contains an indel we set `coordinatesDiverge`, and callers must
 *     stop presenting row numbers as CDS codon positions past that point.
 */

/** Per-codon status. `unsequenced` extends `DiffRow['status']` for the
 *  annotated-but-not-modelled tail of the locus. */
export type CodonStatus = DiffRow['status'] | 'unsequenced';

export interface CodonSegment {
  /**
   * 1-based position. A true CDS codon index while `coordinatesDiverge` is
   * false; an alignment row number after an indel.
   */
  readonly codonIndex: number;
  readonly refCodon: string | null;
  readonly altCodon: string | null;
  readonly refAa: string | null;
  readonly altAa: string | null;
  readonly status: CodonStatus;
  /** Codon changed, amino acid did not. */
  readonly silent: boolean;
  /** False for the annotated tail we hold no sequence for. */
  readonly modelled: boolean;
  /** Exon this codon falls in, from the locus annotation; null if unannotated. */
  readonly exonIndex: number | null;
}

/** Provenance and limitation text that must travel with any structural claim. */
export interface ModelAnnotation {
  readonly variantLabel: string;
  readonly hgvs: string | null;
  readonly proteinHgvs: string | null;
  readonly legacyName: string | null;
  readonly numberingNote: string | null;
  readonly structural: StructuralAnnotation | null;
  readonly provenance: string | null;
}

export interface GenomeModel {
  readonly gene: string;
  /** Full locus name, e.g. "Haemoglobin subunit beta"; null for ad-hoc input. */
  readonly locusName: string | null;
  readonly chromosome: string | null;
  readonly refLabel: string;
  readonly altLabel: string;
  /** One entry per codon of the drawn region, in order. */
  readonly segments: readonly CodonSegment[];
  /** Codons carrying real sequence. */
  readonly modelledCodonCount: number;
  /** Codons drawn in total, including the annotated unsequenced tail. */
  readonly totalCodonCount: number;
  /** 1-based positions whose codon differs between ref and alt. */
  readonly editedCodonIndices: readonly number[];
  /** The codon the view focuses by default. */
  readonly primaryEditedCodon: number | null;
  readonly refProtein: string;
  readonly altProtein: string;
  /** True when the diff contains an added/removed codon — see rule 2 above. */
  readonly coordinatesDiverge: boolean;
  readonly annotation: ModelAnnotation | null;
  /**
   * The fixture's own limitation text, surfaced wherever a structural claim
   * appears. Null when the input is an ad-hoc sequence with no annotation.
   */
  readonly limitation: string | null;
}

function exonIndexFor(locus: Locus | null, codonIndex: number): number | null {
  if (locus === null) return null;
  const exon = locus.exons.find(
    (e) => codonIndex >= e.codonStart && codonIndex <= e.codonEnd,
  );
  return exon === undefined ? null : exon.index;
}

/** The locus's annotated extent in codons, or the modelled length if wider. */
function annotatedCodonCount(locus: Locus | null, modelled: number): number {
  if (locus === null) return modelled;
  const end = locus.exons.reduce((max, e) => Math.max(max, e.codonEnd), 0);
  return Math.max(end, modelled);
}

function segmentsFromDiff(
  rows: readonly DiffRow[],
  locus: Locus | null,
  totalCodonCount: number,
): CodonSegment[] {
  const segments: CodonSegment[] = rows.map((row) => ({
    codonIndex: row.codonIndex,
    refCodon: row.refCodon,
    altCodon: row.altCodon,
    refAa: row.refAa,
    altAa: row.altAa,
    status: row.status,
    silent: row.silent,
    modelled: true,
    exonIndex: exonIndexFor(locus, row.codonIndex),
  }));

  for (let i = rows.length + 1; i <= totalCodonCount; i += 1) {
    segments.push({
      codonIndex: i,
      refCodon: null,
      altCodon: null,
      refAa: null,
      altAa: null,
      status: 'unsequenced',
      silent: false,
      modelled: false,
      exonIndex: exonIndexFor(locus, i),
    });
  }
  return segments;
}

interface BuildInput {
  readonly ref: Sequence;
  readonly alt: Sequence;
  readonly locus?: Locus | null;
  readonly annotation?: ModelAnnotation | null;
  /** Override the drawn extent; defaults to the locus annotation. */
  readonly totalCodonCount?: number;
  /** Prefer this codon for the initial focus, when it actually changed. */
  readonly preferredCodonIndex?: number;
}

/**
 * Build a model from two sequences. Propagates `lib/genome`'s
 * `InvalidBaseError` / `PartialCodonError` unchanged so a caller validating
 * user input can surface them as inline form errors (SPEC §4.6 #13/#14).
 */
export function buildGenomeModel(input: BuildInput): GenomeModel {
  const { ref, alt, locus = null, annotation = null, preferredCodonIndex } = input;
  const rows = diffSequences(ref, alt);

  const modelledCodonCount = rows.length;
  const totalCodonCount = Math.max(
    input.totalCodonCount ?? annotatedCodonCount(locus, modelledCodonCount),
    modelledCodonCount,
  );
  const segments = segmentsFromDiff(rows, locus, totalCodonCount);

  const editedCodonIndices = rows
    .filter((r) => r.status !== 'same')
    .map((r) => r.codonIndex);
  const coordinatesDiverge = rows.some(
    (r) => r.status === 'added' || r.status === 'removed',
  );

  const preferred =
    preferredCodonIndex !== undefined && editedCodonIndices.includes(preferredCodonIndex)
      ? preferredCodonIndex
      : undefined;
  const primaryEditedCodon = preferred ?? editedCodonIndices[0] ?? null;

  return {
    gene: locus?.gene ?? 'uploaded',
    locusName: locus?.name ?? null,
    chromosome: locus?.chromosome ?? null,
    refLabel: ref.label,
    altLabel: alt.label,
    segments,
    modelledCodonCount,
    totalCodonCount,
    editedCodonIndices,
    primaryEditedCodon,
    refProtein: translate(ref.bases),
    altProtein: translate(alt.bases),
    coordinatesDiverge,
    annotation,
    limitation: annotation?.structural?.limitation ?? null,
  };
}

function annotationOf(variant: LocusVariant): ModelAnnotation {
  return {
    variantLabel: variant.label,
    hgvs: variant.hgvs ?? null,
    proteinHgvs: variant.proteinHgvs ?? null,
    legacyName: variant.legacyName ?? null,
    numberingNote: variant.numberingNote ?? null,
    structural: variant.structural,
    provenance: variant.provenance,
  };
}

export class UnknownLocusError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'UnknownLocusError';
  }
}

export interface LocusModelOptions {
  /** Gene symbol in `loci.json`. Default `HBB`. */
  readonly gene?: string;
  /** Variant id, e.g. `HBB_HbS`. Default: the locus's first variant. */
  readonly variantId?: string;
}

/**
 * The default path: diff a curated locus's reference allele against one of
 * its curated variants. Throws `UnknownLocusError` rather than falling back
 * to a hardcoded sequence, so a typo is visible instead of silently drawing
 * the wrong gene.
 */
export function buildLocusModel(options: LocusModelOptions = {}): GenomeModel {
  const gene = options.gene ?? 'HBB';
  const locus = getLocus(gene);
  if (locus === undefined) {
    throw new UnknownLocusError(`No locus '${gene}' in loci.json`);
  }

  const variant =
    options.variantId === undefined
      ? locus.variants[0]
      : variantById(locus, options.variantId);
  if (variant === undefined) {
    throw new UnknownLocusError(
      options.variantId === undefined
        ? `Locus ${locus.gene} has no variants to diff`
        : `Locus ${locus.gene} has no variant '${options.variantId}'`,
    );
  }

  const ref = referenceSequence(locus);
  // `applyVariant` is the only thing that may mutate a sequence: it validates
  // refCodon against the reference and owns the indel coordinate rules
  // (SPEC §4.5 #6, §4.6 #15). Re-implementing it here would be a second,
  // unverified copy of the edit semantics.
  const applied = applyVariant(ref, variant);
  const alt: Sequence = { bases: applied.bases, label: variant.label };

  return buildGenomeModel({
    ref,
    alt,
    locus,
    annotation: annotationOf(variant),
    preferredCodonIndex: variant.codonIndex,
  });
}

/** Short one-line description of the edit, for headings and `aria-label`. */
export function describeEdit(model: GenomeModel): string {
  const index = model.primaryEditedCodon;
  if (index === null) return `${model.gene}: no codon differs between the two sequences`;
  const segment = model.segments.find((s) => s.codonIndex === index);
  if (segment === undefined) return `${model.gene}: codon ${index} changed`;

  const position = model.coordinatesDiverge
    ? `alignment row ${index}`
    : `codon ${index}`;
  if (segment.status === 'added') {
    return `${model.gene}: codon ${segment.altCodon} inserted at ${position}`;
  }
  if (segment.status === 'removed') {
    return `${model.gene}: codon ${segment.refCodon} deleted at ${position}`;
  }
  const aa =
    segment.silent
      ? `, amino acid unchanged (${segment.refAa ?? '?'})`
      : ` (${segment.refAa ?? '?'} to ${segment.altAa ?? '?'})`;
  return `${model.gene}: ${segment.refCodon ?? '?'} to ${segment.altCodon ?? '?'} at ${position}${aa}`;
}

/**
 * The structural summary used as the text alternative and as the content of
 * the failure fallback, so a viewer with no GPU still learns what changed.
 */
export function structuralSummary(model: GenomeModel): string {
  const parts: string[] = [describeEdit(model)];
  parts.push(
    `${model.modelledCodonCount} codons modelled` +
      (model.totalCodonCount > model.modelledCodonCount
        ? ` of ${model.totalCodonCount} annotated for this locus`
        : ''),
  );
  const structural = model.annotation?.structural;
  if (structural !== undefined && structural !== null) {
    parts.push(structural.summary);
  }
  if (model.coordinatesDiverge) {
    parts.push(
      'This diff contains an indel, so positions after it are alignment rows, not CDS codon numbers',
    );
  }
  // Fixture prose already ends in a full stop; joining blindly doubles it.
  return parts.map((p) => p.replace(/\.$/, '')).join('. ') + '.';
}
