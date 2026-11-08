/**
 * Minimal PDB record parsing that complements three's `PDBLoader`.
 *
 * `PDBLoader.parse()` gives positions and CPK colours but drops residue and
 * chain identity. We need those to find the edited residue, so we re-read the
 * same `ATOM`/`HETATM` lines using the *same line filter* PDBLoader uses
 * (`slice(0,4) === 'ATOM' || slice(0,6) === 'HETATM'`). Index `i` here is
 * therefore index `i` in PDBLoader's geometry — `assertAligned` checks it.
 *
 * Pure, three-free, DOM-free: unit-testable in node.
 */

export interface AtomRecord {
  readonly serial: number;
  readonly name: string;
  readonly resName: string;
  readonly chainId: string;
  readonly resSeq: number;
  readonly hetero: boolean;
  readonly element: string;
}

export interface MoleculeEntry {
  readonly molecule: string;
  readonly chains: readonly string[];
}

function isAtomLine(line: string): boolean {
  return line.slice(0, 4) === 'ATOM' || line.slice(0, 6) === 'HETATM';
}

export function parseAtomRecords(text: string): AtomRecord[] {
  const out: AtomRecord[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (!isAtomLine(line)) continue;
    const element = line.slice(76, 78).trim() || line.slice(12, 14).trim();
    out.push({
      serial: Number.parseInt(line.slice(6, 11), 10),
      name: line.slice(12, 16).trim(),
      resName: line.slice(17, 20).trim(),
      chainId: line.slice(21, 22).trim() || '_',
      resSeq: Number.parseInt(line.slice(22, 26), 10),
      hetero: line.slice(0, 6) === 'HETATM',
      element: element.toUpperCase(),
    });
  }
  return out;
}

/** Concatenated `TITLE` record, as deposited. `null` if absent. */
export function parseTitle(text: string): string | null {
  const parts: string[] = [];
  for (const line of text.split('\n')) {
    if (line.slice(0, 6) !== 'TITLE ') continue;
    parts.push(line.slice(10, 80).trim());
  }
  const title = parts.join(' ').replace(/\s+/g, ' ').trim();
  return title === '' ? null : title;
}

/** `COMPND` MOLECULE/CHAIN pairs, as deposited — used for legend labels so
 *  the legend names what the file says, not what we assume. */
export function parseMolecules(text: string): MoleculeEntry[] {
  const body = text
    .split('\n')
    .filter((line) => line.slice(0, 6) === 'COMPND')
    .map((line) => line.slice(10, 80).trim())
    .join(' ');
  const out: MoleculeEntry[] = [];
  for (const block of body.split(/MOL_ID:/).slice(1)) {
    const molecule = /MOLECULE:\s*([^;]+);?/.exec(block)?.[1]?.trim();
    const chains = /CHAIN:\s*([^;]+);?/.exec(block)?.[1];
    if (molecule === undefined || chains === undefined) continue;
    out.push({
      molecule,
      chains: chains
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c !== ''),
    });
  }
  return out;
}

export interface ResidueSelection {
  /** Chains whose residue `resSeq` is the expected amino acid. */
  readonly matchedChains: readonly string[];
  /** Atom indices (aligned with PDBLoader output) of those residues. */
  readonly atomIndices: readonly number[];
  /** Per matched chain, its atom indices — for per-residue halos. */
  readonly byChain: ReadonlyMap<string, readonly number[]>;
  /** Chains that have a residue at `resSeq` but a different amino acid. */
  readonly otherChains: ReadonlyArray<{ chainId: string; resName: string }>;
}

/**
 * Find residue `resSeq` in every polymer chain and keep the chains where it
 * is the amino acid the fixture says this structure should carry.
 *
 * Checking the residue name — not just the number — is the honesty guard:
 * if the fixture's position or numbering offset were wrong, nothing would be
 * highlighted and the UI would say so, instead of confidently marking an
 * unrelated residue.
 */
export function selectResidue(
  atoms: readonly AtomRecord[],
  resSeq: number,
  expectedResName: string,
): ResidueSelection {
  const byChain = new Map<string, number[]>();
  const other = new Map<string, string>();
  for (let i = 0; i < atoms.length; i += 1) {
    const atom = atoms[i];
    if (atom === undefined || atom.hetero || atom.resSeq !== resSeq) continue;
    if (atom.resName === expectedResName) {
      const list = byChain.get(atom.chainId) ?? [];
      list.push(i);
      byChain.set(atom.chainId, list);
    } else if (!other.has(atom.chainId)) {
      other.set(atom.chainId, atom.resName);
    }
  }
  const matchedChains = [...byChain.keys()];
  const atomIndices = matchedChains.flatMap((c) => byChain.get(c) ?? []);
  return {
    matchedChains,
    atomIndices,
    byChain,
    otherChains: [...other.entries()].map(([chainId, resName]) => ({ chainId, resName })),
  };
}

export interface ChainTrace {
  readonly chainId: string;
  /** Atom indices of Cα atoms in chain order. */
  readonly caIndices: readonly number[];
}

/** Cα trace per polymer chain, for the backbone tubes. */
export function backboneTraces(atoms: readonly AtomRecord[]): ChainTrace[] {
  const order: string[] = [];
  const traces = new Map<string, number[]>();
  for (let i = 0; i < atoms.length; i += 1) {
    const atom = atoms[i];
    if (atom === undefined || atom.hetero || atom.name !== 'CA') continue;
    let list = traces.get(atom.chainId);
    if (list === undefined) {
      list = [];
      traces.set(atom.chainId, list);
      order.push(atom.chainId);
    }
    list.push(i);
  }
  return order.map((chainId) => ({ chainId, caIndices: traces.get(chainId) ?? [] }));
}

/** Hetero groups we draw (e.g. haem). Water and lone ions are skipped. */
export function ligandAtomIndices(atoms: readonly AtomRecord[]): number[] {
  const skip = new Set(['HOH', 'WAT', 'DOD']);
  const out: number[] = [];
  for (let i = 0; i < atoms.length; i += 1) {
    const atom = atoms[i];
    if (atom === undefined || !atom.hetero || skip.has(atom.resName)) continue;
    out.push(i);
  }
  return out;
}
