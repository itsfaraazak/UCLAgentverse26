/** Hard caps. Stated in the UI, so they must be exported. */
export const UPLOAD_LIMITS: {
  /** Max characters of raw input text accepted at all. */
  readonly maxRawChars: number;
  /** Max bases in the cleaned sequence. */
  readonly maxBases: number;
} = {
  // Demo-scale cap that keeps parsing, diffing and 3D instancing interactive, not a biological limit.
  maxRawChars: 1_000_000,
  maxBases: 60_000,
};

export type FastaErrorCode =
  | 'empty' // nothing but whitespace
  | 'too-large-raw' // raw text over maxRawChars
  | 'too-large-bases' // cleaned sequence over maxBases
  | 'no-sequence' // a header but no sequence lines under it
  | 'multiple-records' // more than one '>' record
  | 'stray-sequence'; // sequence text above the header, which would be dropped

/** A parse failure with a message safe and useful to show inline in a form. */
export class FastaParseError extends Error {
  readonly code: FastaErrorCode;
  /** Extra detail for the UI, e.g. the observed count. */
  readonly detail: string;

  constructor(code: FastaErrorCode, message: string, detail = '') {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.detail = detail;
  }
}

export interface ParsedFasta {
  /** Cleaned: uppercase, all whitespace removed. NOT validated for ACGT —
   *  the caller runs lib/genome's normalizeDna for that. */
  readonly bases: string;
  /** From the FASTA header (first word or the whole description, trimmed),
   *  or a sensible fallback when the input was a bare sequence. */
  readonly label: string;
  /** True when the input carried a '>' header. */
  readonly hadHeader: boolean;
  /** The full header description line, without '>', when there was one. */
  readonly description: string | null;
}

function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

function defaultLabel(options?: { readonly fallbackLabel?: string }): string {
  return options?.fallbackLabel ?? 'Pasted sequence';
}

function labelFromDescription(
  description: string,
  fallback: string,
): string {
  const token = description.split(/\s+/).find((part) => part.length > 0);
  return token ?? fallback;
}

function cleanBases(chunks: readonly string[]): string {
  return chunks.join('').replace(/\s/g, '').toUpperCase();
}

/**
 * Parse either a one-record FASTA document or a bare pasted sequence.
 */
export function parseFasta(
  text: string,
  options?: { readonly fallbackLabel?: string },
): ParsedFasta {
  const fallback = defaultLabel(options);

  if (text.length > UPLOAD_LIMITS.maxRawChars) {
    throw new FastaParseError(
      'too-large-raw',
      `This input is ${formatCount(text.length)} characters, which exceeds the ${formatCount(UPLOAD_LIMITS.maxRawChars)} character limit.`,
      String(text.length),
    );
  }

  if (text.trim() === '') {
    throw new FastaParseError(
      'empty',
      'Paste a DNA sequence or a FASTA record — the input was empty.',
      '0',
    );
  }

  const lines = text.split(/\r\n|\n|\r/);
  const headerIndexes: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line !== undefined && line.startsWith('>')) {
      headerIndexes.push(i);
    }
  }

  if (headerIndexes.length > 1) {
    throw new FastaParseError(
      'multiple-records',
      `Found ${formatCount(headerIndexes.length)} FASTA records. Please provide a single coding sequence.`,
      String(headerIndexes.length),
    );
  }

  const headerIndex = headerIndexes[0];
  const hadHeader = headerIndex !== undefined;

  // Anything that looks like sequence *above* the single header would be
  // dropped by the loop below. Silently discarding data the user supplied is
  // exactly what this project refuses to do (SPEC §4.6 #13), so say so.
  if (headerIndex !== undefined) {
    const strayAbove = lines
      .slice(0, headerIndex)
      .some((line) => line.trim() !== '' && !line.startsWith(';'));
    if (strayAbove) {
      throw new FastaParseError(
        'stray-sequence',
        "Found sequence text above the '>' header. Put the header first, or paste the sequence on its own.",
        String(headerIndex),
      );
    }
  }
  const description = hadHeader
    ? (lines[headerIndex] ?? '').slice(1).trim()
    : null;

  const sequenceChunks: string[] = [];
  const start = hadHeader ? headerIndex + 1 : 0;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || line.startsWith(';') || line.startsWith('>')) {
      continue;
    }
    sequenceChunks.push(line);
  }

  const bases = cleanBases(sequenceChunks);

  if (bases.length > UPLOAD_LIMITS.maxBases) {
    throw new FastaParseError(
      'too-large-bases',
      `The sequence has ${formatCount(bases.length)} bases, which exceeds the ${formatCount(UPLOAD_LIMITS.maxBases)} base limit.`,
      String(bases.length),
    );
  }

  if (bases.length === 0) {
    if (hadHeader) {
      throw new FastaParseError(
        'no-sequence',
        "The FASTA header has no sequence under it. Add the coding sequence on the lines below the '>' header.",
        description ?? '',
      );
    }
    throw new FastaParseError(
      'empty',
      'Paste a DNA sequence or a FASTA record — no sequence was found.',
      '0',
    );
  }

  const label =
    hadHeader && description !== null && description.length > 0
      ? labelFromDescription(description, fallback)
      : fallback;

  return {
    bases,
    label,
    hadHeader,
    description,
  };
}
