import { afterEach, describe, expect, it, vi } from 'vitest';
import lociFile from '@/data/loci.json';
import { describeChange, resolveResidueChange } from './fixture';
import {
  backboneTraces,
  ligandAtomIndices,
  parseAtomRecords,
  parseMolecules,
  parseTitle,
  selectResidue,
} from './pdb';
import { clearPdbCache, fetchPdbText, rcsbUrl } from './pdb-source';
import { ATOMS_PER_RESIDUE, syntheticPdb } from './__fixtures__/pdb';
import { classifyFailure } from './runtime/errors';

const HBS = lociFile.loci[0]?.variants.find((v) => v.id === 'HBB_HbS');

describe('resolveResidueChange', () => {
  it('defaults position and residues from loci.json HBB_HbS', () => {
    const change = resolveResidueChange();
    expect(HBS).toBeDefined();
    expect(change.codonIndex).toBe(HBS?.codonIndex);
    expect(change.ref.code).toBe(HBS?.structural.refAa);
    expect(change.alt.code).toBe(HBS?.structural.altAa);
    expect(change.ref.name).toBe(HBS?.structural.refAaName);
    expect(change.alt.name).toBe(HBS?.structural.altAaName);
    expect(change.summary).toBe(HBS?.structural.summary);
    expect(change.limitation).toBe(HBS?.structural.limitation);
    expect(change.overridden).toBe(false);
  });

  it('maps CDS codon 7 to mature-chain residue 6 (initiator Met removed)', () => {
    const change = resolveResidueChange();
    expect(change.codonIndex).toBe(7);
    expect(change.pdbResidueNumber).toBe(6);
    expect(describeChange(change)).toContain('Glutamate (Glu, E) → Valine (Val, V) at codon 7');
  });

  it('accepts prop overrides and drops fixture prose that no longer applies', () => {
    const change = resolveResidueChange({ codonIndex: 9, refAa: 'k', altAa: 'R' });
    expect(change.codonIndex).toBe(9);
    expect(change.ref.name).toBe('Lysine');
    expect(change.alt.three).toBe('ARG');
    expect(change.overridden).toBe(true);
    expect(change.consequence).toBeNull();
    expect(change.limitation).toBeNull();
  });

  it('resolves the repair variant in the reverse direction', () => {
    const change = resolveResidueChange({ variantId: 'HBB_repair' });
    expect(change.ref.code).toBe('V');
    expect(change.alt.code).toBe('E');
    expect(change.overridden).toBe(false);
  });
});

describe('PDB parsing', () => {
  const text = syntheticPdb('VAL');
  const atoms = parseAtomRecords(text);

  it('reads ATOM/HETATM with chain and residue identity', () => {
    expect(atoms).toHaveLength((8 + 9) * ATOMS_PER_RESIDUE + 4);
    expect(atoms[1]).toMatchObject({ name: 'CA', resName: 'VAL', chainId: 'A', resSeq: 1, hetero: false });
    expect(atoms.at(-1)).toMatchObject({ resName: 'HOH', hetero: true });
  });

  it('reads TITLE and COMPND as deposited', () => {
    expect(parseTitle(text)).toBe('SYNTHETIC TEST STRUCTURE FOR RENDERER UNIT TESTS');
    expect(parseMolecules(text)).toEqual([
      { molecule: 'ALPHA-LIKE TEST CHAIN', chains: ['A'] },
      { molecule: 'BETA-LIKE TEST CHAIN', chains: ['B'] },
    ]);
  });

  it('highlights only chains whose residue 6 is the expected amino acid', () => {
    const sel = selectResidue(atoms, 6, 'VAL');
    expect(sel.matchedChains).toEqual(['B']);
    expect(sel.atomIndices).toHaveLength(ATOMS_PER_RESIDUE);
    for (const i of sel.atomIndices) expect(atoms[i]).toMatchObject({ chainId: 'B', resSeq: 6 });
    expect(sel.otherChains).toEqual([{ chainId: 'A', resName: 'ASP' }]);
  });

  it('withholds the highlight when the structure does not carry the expected residue', () => {
    const sel = selectResidue(parseAtomRecords(syntheticPdb('GLU')), 6, 'VAL');
    expect(sel.matchedChains).toEqual([]);
    expect(sel.atomIndices).toEqual([]);
  });

  it('builds a Cα trace per chain and skips water', () => {
    const traces = backboneTraces(atoms);
    expect(traces.map((t) => t.chainId)).toEqual(['A', 'B']);
    expect(traces[0]?.caIndices).toHaveLength(8);
    const ligands = ligandAtomIndices(atoms).map((i) => atoms[i]?.resName);
    expect(ligands).toEqual(['HEM', 'HEM']);
  });
});

describe('fetchPdbText', () => {
  afterEach(() => {
    clearPdbCache();
    vi.useRealTimers();
  });

  const okResponse = (body: string): Response => new Response(body, { status: 200 });

  it('downloads from the public RCSB endpoint and memoises', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse(syntheticPdb('VAL')));
    const signal = new AbortController().signal;
    const a = await fetchPdbText('2hbs', signal, { fetchImpl });
    const b = await fetchPdbText('2HBS', signal, { fetchImpl });
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(rcsbUrl('2HBS'));
    expect(rcsbUrl('2HBS')).toBe('https://files.rcsb.org/download/2HBS.pdb');
  });

  it('classifies a network failure as "network"', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = await fetchPdbText('2HBS', new AbortController().signal, { fetchImpl }).catch((e: unknown) => e);
    expect(classifyFailure(err)).toBe('network');
    expect(String(err)).toContain('Failed to fetch');
  });

  it('classifies an HTTP error as "network" and does not cache it', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('nope', { status: 503 }))
      .mockResolvedValueOnce(okResponse(syntheticPdb('VAL')));
    const signal = new AbortController().signal;
    const err = await fetchPdbText('2HBS', signal, { fetchImpl }).catch((e: unknown) => e);
    expect(classifyFailure(err)).toBe('network');
    expect(String(err)).toContain('503');
    await expect(fetchPdbText('2HBS', signal, { fetchImpl })).resolves.toContain('ATOM');
  });

  it('rejects a 200 that is not a PDB file (captive portal) without caching it', async () => {
    const fetchImpl = vi.fn(async () => okResponse('<html>Sign in to Wi-Fi</html>'));
    const err = await fetchPdbText('2HBS', new AbortController().signal, { fetchImpl }).catch((e: unknown) => e);
    expect(classifyFailure(err)).toBe('network');
    expect(String(err)).toContain('not a PDB coordinate file');
  });

  it('times out instead of hanging on slow wifi', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = fetchPdbText('2HBS', new AbortController().signal, { fetchImpl, timeoutMs: 1000 }).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(1001);
    const err = await pending;
    expect(classifyFailure(err)).toBe('network');
    expect(String(err)).toContain('Timed out');
  });

  it('aborts the in-flight request when the caller aborts (unmount)', async () => {
    let seen: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          seen = init?.signal ?? undefined;
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const controller = new AbortController();
    const pending = fetchPdbText('2HBS', controller.signal, { fetchImpl }).catch((e: unknown) => e);
    controller.abort();
    const err = await pending;
    expect(seen?.aborted).toBe(true);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('AbortError');
  });

  it('refuses identifiers that are not PDB ids', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const err = await fetchPdbText('../../etc', new AbortController().signal, { fetchImpl }).catch((e: unknown) => e);
    expect(classifyFailure(err)).toBe('network');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
