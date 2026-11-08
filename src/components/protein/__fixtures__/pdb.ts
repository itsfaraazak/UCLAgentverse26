/**
 * Synthetic, fixed-column PDB text for tests. Coordinates are invented and
 * describe no real molecule; only the record layout matters.
 *
 * Shape: chain A ("ALPHA-LIKE") has ASP at 6; chain B ("BETA-LIKE") has the
 * residue passed in at 6 (VAL for a sickle-like file, GLU for reference-like);
 * one HEM ligand group and two waters.
 */

function atomLine(
  record: 'ATOM' | 'HETATM',
  serial: number,
  name: string,
  resName: string,
  chain: string,
  resSeq: number,
  x: number,
  y: number,
  z: number,
  element: string,
): string {
  const atomName = name.length < 4 ? ` ${name}`.padEnd(4) : name;
  return (
    record.padEnd(6) +
    String(serial).padStart(5) +
    ' ' +
    atomName +
    ' ' +
    resName.padStart(3) +
    ' ' +
    chain +
    String(resSeq).padStart(4) +
    '    ' +
    x.toFixed(3).padStart(8) +
    y.toFixed(3).padStart(8) +
    z.toFixed(3).padStart(8) +
    '  1.00' +
    '  0.00' +
    ' '.repeat(10) +
    element.padStart(2)
  );
}

const ALPHA_LIKE = ['VAL', 'LEU', 'SER', 'PRO', 'ALA', 'ASP', 'LYS', 'THR'];
const BETA_PREFIX = ['VAL', 'HIS', 'LEU', 'THR', 'PRO'];
const BETA_SUFFIX = ['GLU', 'LYS', 'SER'];

export function syntheticPdb(betaResidue6: string): string {
  const lines: string[] = [
    'HEADER    SYNTHETIC TEST FIXTURE',
    'TITLE     SYNTHETIC TEST STRUCTURE FOR RENDERER UNIT TESTS',
    'COMPND    MOL_ID: 1;',
    'COMPND   2 MOLECULE: ALPHA-LIKE TEST CHAIN;',
    'COMPND   3 CHAIN: A;',
    'COMPND   4 MOL_ID: 2;',
    'COMPND   5 MOLECULE: BETA-LIKE TEST CHAIN;',
    'COMPND   6 CHAIN: B;',
  ];
  let serial = 1;
  const chains: Array<[string, string[], number]> = [
    ['A', ALPHA_LIKE, 0],
    ['B', [...BETA_PREFIX, betaResidue6, ...BETA_SUFFIX], 20],
  ];
  for (const [chain, residues, offset] of chains) {
    residues.forEach((resName, i) => {
      const resSeq = i + 1;
      const x = offset + i * 3.8;
      const y = Math.sin(i) * 2;
      lines.push(atomLine('ATOM', serial++, 'N', resName, chain, resSeq, x - 1, y, 0, 'N'));
      lines.push(atomLine('ATOM', serial++, 'CA', resName, chain, resSeq, x, y, 0.5, 'C'));
      lines.push(atomLine('ATOM', serial++, 'C', resName, chain, resSeq, x + 1, y, 0, 'C'));
      lines.push(atomLine('ATOM', serial++, 'CB', resName, chain, resSeq, x, y + 1.5, 1, 'C'));
    });
    lines.push(`TER   ${String(serial++).padStart(5)}`);
  }
  lines.push(atomLine('HETATM', serial++, 'FE', 'HEM', 'B', 147, 30, 5, 5, 'FE'));
  lines.push(atomLine('HETATM', serial++, 'NA', 'HEM', 'B', 147, 31, 5, 5, 'N'));
  lines.push(atomLine('HETATM', serial++, 'O', 'HOH', 'A', 201, 50, 50, 50, 'O'));
  lines.push(atomLine('HETATM', serial++, 'O', 'HOH', 'B', 202, 51, 50, 50, 'O'));
  lines.push('END');
  return lines.join('\n');
}

/** Atoms per residue in `syntheticPdb`. */
export const ATOMS_PER_RESIDUE = 4;
