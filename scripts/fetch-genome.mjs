#!/usr/bin/env node
/**
 * Reproduce `src/data/genomes/hbb-nm_000518.5.json` from NCBI Nucleotide.
 *
 * The demo must work offline, so the fetched record is committed as a data
 * file and nothing in the app fetches at runtime. This script exists so a
 * reviewer can re-derive that file and confirm it was not hand-typed.
 *
 *   node scripts/fetch-genome.mjs           # fetch and rewrite the data file
 *   node scripts/fetch-genome.mjs --check   # fetch and diff against the file
 *
 * `--check` is the CI-friendly form: it exits non-zero if the committed
 * sequence no longer matches the live record, without touching the tree.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(HERE, '..', 'src', 'data', 'genomes', 'hbb-nm_000518.5.json');

/** The record this script is pinned to. */
const ACCESSION = 'NM_000518.5';
const EFETCH_URL =
  'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi' +
  `?db=nuccore&id=${ACCESSION}&rettype=fasta&retmode=text`;

/**
 * Identify the client politely, per NCBI's E-utilities usage guidance.
 * Deliberately carries no personal contact details.
 */
const USER_AGENT =
  'sigmafold/0.1 (UCL AgentVerse 2026 research prototype; +https://github.com/paramveersi/UCLAgentverse26)';

/**
 * Invariants verified at fetch time. If NCBI ever serves something different
 * under this accession, the script fails loudly rather than silently
 * rewriting the fixture the whole demo is built on.
 */
const EXPECTED = Object.freeze({
  lengthNt: 628,
  /** sha256 of the bare sequence, no header, no newlines. */
  sha256: '9e811fb12c639fc6610265da635ebbf31521b62410132c6e19dfd0192bd194f3',
  /** 0-based offset of the CDS start (the initiator ATG) within the mRNA. */
  cdsOffset: 50,
  /** Codons in the CDS including the terminator: 147 residues + 1 stop. */
  cdsCodonCount: 148,
  cdsPrefix: 'ATGGTGCATCTGACTCCTGAG',
  /** First 31 residues — the region the original hand-typed fixture covered. */
  proteinPrefix: 'MVHLTPEEKSAVTALWGKVNVDEVGGEALGR',
});

/** Minimal standard genetic code, built rather than tabulated. */
const CODON_TABLE = (() => {
  const aas = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
  const order = 'TCAG';
  const table = {};
  let i = 0;
  for (const a of order) {
    for (const b of order) {
      for (const c of order) {
        table[a + b + c] = aas[i++];
      }
    }
  }
  return table;
})();

function parseFasta(text) {
  const lines = text.split('\n');
  const header = lines.find((l) => l.startsWith('>'));
  if (header === undefined) {
    throw new Error('response is not FASTA: no header line beginning with ">"');
  }
  const bases = lines
    .filter((l) => !l.startsWith('>'))
    .join('')
    .replace(/\s+/g, '')
    .toUpperCase();
  const bad = bases.match(/[^ACGT]/);
  if (bad !== null) {
    throw new Error(
      `fetched sequence contains non-ACGT character ${JSON.stringify(bad[0])} at offset ${bad.index}`,
    );
  }
  return { title: header.slice(1).trim(), bases };
}

/** Translate from `offset` until the first stop, inclusive. */
function translateFrom(bases, offset) {
  let protein = '';
  for (let i = offset; i + 3 <= bases.length; i += 3) {
    const aa = CODON_TABLE[bases.slice(i, i + 3)];
    protein += aa;
    if (aa === '*') break;
  }
  return protein;
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(
      `${ACCESSION} ${label} mismatch: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    );
  }
}

async function main() {
  const check = process.argv.includes('--check');

  process.stderr.write(`fetching ${ACCESSION} from NCBI E-utilities…\n`);
  const response = await fetch(EFETCH_URL, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    throw new Error(`efetch failed: HTTP ${response.status} ${response.statusText}`);
  }
  const { title, bases } = parseFasta(await response.text());

  const sha256 = createHash('sha256').update(bases, 'utf8').digest('hex');
  const protein = translateFrom(bases, EXPECTED.cdsOffset);

  assertEqual('length', bases.length, EXPECTED.lengthNt);
  assertEqual('sha256', sha256, EXPECTED.sha256);
  assertEqual(
    'CDS prefix',
    bases.slice(EXPECTED.cdsOffset, EXPECTED.cdsOffset + EXPECTED.cdsPrefix.length),
    EXPECTED.cdsPrefix,
  );
  assertEqual('CDS codon count', protein.length, EXPECTED.cdsCodonCount);
  assertEqual('protein prefix', protein.slice(0, 31), EXPECTED.proteinPrefix);
  if (!protein.endsWith('*')) {
    throw new Error(`${ACCESSION}: CDS translation does not end in a stop codon`);
  }
  process.stderr.write(
    `verified: ${bases.length} nt, CDS at offset ${EXPECTED.cdsOffset}, ` +
      `${protein.length - 1} residues + stop\n`,
  );

  const record = {
    _disclaimer:
      'Public reference sequence retrieved from NCBI Nucleotide and committed so the ' +
      'demo runs offline. Regenerate with `node scripts/fetch-genome.mjs`; verify the ' +
      'committed copy against the live record with `--check`. No patient data, no ' +
      'construct design content (see SPEC.md section 7).',
    provenance: {
      accession: ACCESSION,
      title,
      database: 'NCBI Nucleotide (nuccore)',
      sourceUrl: EFETCH_URL,
      // Retrieval date is the date this file was regenerated, in UTC.
      retrievedAt: new Date().toISOString().slice(0, 10),
      retrievedBy: 'scripts/fetch-genome.mjs',
      licence:
        'NCBI public-domain reference record; see https://www.ncbi.nlm.nih.gov/home/about/policies/',
      provenanceLabel: 'public-reference',
    },
    molecule: {
      type: 'mRNA',
      lengthNt: bases.length,
      sha256,
      alphabet: 'ACGT',
    },
    cds: {
      /** 0-based, inclusive start of the initiator ATG within `bases`. */
      offset: EXPECTED.cdsOffset,
      lengthNt: protein.length * 3,
      /** Includes the terminator codon. */
      codonCount: protein.length,
      residueCount: protein.length - 1,
      protein,
      note:
        'CDS runs from offset 50 to 494 (exclusive). 147 residues plus one stop codon. ' +
        'Codon numbering in loci.json and SPEC.md is 1-based CDS numbering, so codon 7 ' +
        'is the sickle position (NM_000518.5(HBB):c.20A>T, p.Glu7Val).',
    },
    bases,
  };

  const serialised = `${JSON.stringify(record, null, 2)}\n`;

  if (check) {
    const existing = await readFile(OUT_PATH, 'utf8');
    const existingRecord = JSON.parse(existing);
    // Compare the scientific content, not the retrieval timestamp.
    if (existingRecord.bases !== bases) {
      throw new Error(
        `${OUT_PATH} is out of date: committed sequence differs from the live ${ACCESSION} record`,
      );
    }
    if (existingRecord.molecule?.sha256 !== sha256) {
      throw new Error(`${OUT_PATH}: recorded sha256 does not match the live record`);
    }
    process.stderr.write('check: committed data file matches the live record\n');
    return;
  }

  await writeFile(OUT_PATH, serialised, 'utf8');
  process.stderr.write(`wrote ${path.relative(path.join(HERE, '..'), OUT_PATH)}\n`);
}

main().catch((err) => {
  process.stderr.write(`fetch-genome: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
