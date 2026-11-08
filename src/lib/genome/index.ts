export { CODON_TABLE, aminoAcid, isStopCodon } from './codon-table';
export { translate, codons } from './translate';
export {
  GenomeInputError,
  InvalidBaseError,
  PartialCodonError,
  InsertionRefCodonError,
} from './errors';
export {
  parseSequenceUpload,
  MAX_UPLOAD_CHARS,
  MAX_SEQUENCE_BASES,
  SequenceTooLargeError,
  EmptySequenceError,
  MultipleRecordsError,
  ExplainedInvalidBaseError,
} from './fasta';
export type { ParsedUpload, ParseUploadOptions } from './fasta';
export { applyVariant, applyVariants } from './variant';
export { diffSequences } from './diff';
export {
  loadLoci,
  getLocus,
  getLocusVariant,
  getGenotype,
  referenceSequence,
  variantById,
  sequenceForGenotype,
} from './loci';
export type {
  Provenance,
  LocusExon,
  StructuralAnnotation,
  CdsReference,
  LocusVariant,
  LocusGenotype,
  Locus,
} from './loci';
export type { Base, Sequence, Variant, VariantKind, DiffRow } from './types';
