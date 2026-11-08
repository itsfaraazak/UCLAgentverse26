// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenomeModel } from '@/components/genome-3d';
import { GenomeUpload } from './GenomeUpload';
import { UPLOAD_LIMITS } from './fasta';

/**
 * These tests pin the safety behaviour of the upload surface, not its looks:
 *
 *  - SPEC §7.3: a refused upload is never echoed back, stored or logged.
 *  - SPEC §7.4: the gate runs before anything else consumes the text.
 *  - SPEC §7.5: an escalation is not auto-approved.
 *  - The brief: uploaded data is session-only — no persistence, no network.
 */

/** The curated HBB reference region: 31 codons, valid. */
const HBB_REF =
  'ATGGTGCATCTGACTCCTGAGGAGAAGTCTGCCGTTACTGCCCTGTGGGGCAAGGTGAACGTGGATGAAGTTGGTGGTGAGGCCCTGGGCAGG';

function paste(value: string): void {
  const box = screen.getByLabelText(/paste a coding sequence/i);
  fireEvent.change(box, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: /screen and load/i }));
}

let setItem: ReturnType<typeof vi.spyOn>;
let sessionSetItem: ReturnType<typeof vi.spyOn>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setItem = vi.spyOn(Storage.prototype, 'setItem');
  sessionSetItem = vi.spyOn(window.sessionStorage, 'setItem');
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GenomeUpload — the demo genome is the default', () => {
  it('starts on the preloaded genome and states the caps', () => {
    render(<GenomeUpload />);
    expect(screen.getByRole('heading', { name: /demo genome/i })).toBeTruthy();
    expect(screen.getByText(/Preloaded/)).toBeTruthy();
    // The cap is stated, not implied.
    expect(
      screen.getByText(new RegExp(UPLOAD_LIMITS.maxBases.toLocaleString('en-GB'))),
    ).toBeTruthy();
    expect(screen.getByText(/session only/i)).toBeTruthy();
  });

  it('says uploaded data is never stored or sent anywhere', () => {
    render(<GenomeUpload />);
    const note = screen.getByText(/never written to storage/i);
    expect(note.textContent).toMatch(/never sent anywhere/i);
  });
});

describe('GenomeUpload — a valid sequence', () => {
  it('screens, parses, validates and hands back a model built from the real diff', async () => {
    const onGenomeChange = vi.fn<(m: GenomeModel | null) => void>();
    render(<GenomeUpload onGenomeChange={onGenomeChange} />);

    // One codon changed from the reference: codon 7 GAG → GTG (the sickle allele).
    const altered = `${HBB_REF.slice(0, 18)}GTG${HBB_REF.slice(21)}`;
    paste(altered);

    await waitFor(() => expect(onGenomeChange).toHaveBeenCalled());
    const model = onGenomeChange.mock.calls[0]?.[0];
    expect(model).not.toBeNull();
    expect(model?.gene).toBe('HBB');
    expect(model?.editedCodonIndices).toEqual([7]);
    expect(model?.segments[6]?.refCodon).toBe('GAG');
    expect(model?.segments[6]?.altCodon).toBe('GTG');
    expect(screen.getByText(/Loaded/)).toBeTruthy();
  });

  it('accepts lowercase and a FASTA header, and offers a reset to the demo genome', async () => {
    const onGenomeChange = vi.fn<(m: GenomeModel | null) => void>();
    render(<GenomeUpload onGenomeChange={onGenomeChange} />);
    paste(`>HBB my copy\n${HBB_REF.toLowerCase()}`);

    await waitFor(() => expect(screen.getByText(/Loaded/)).toBeTruthy());
    expect(screen.getByRole('heading', { name: /uploaded sequence/i })).toBeTruthy();

    const reset = screen.getByRole('button', { name: /reset to demo/i });
    fireEvent.click(reset);
    expect(onGenomeChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('heading', { name: /demo genome/i })).toBeTruthy();
  });

  it('never writes to storage and never calls the network', async () => {
    render(<GenomeUpload />);
    paste(HBB_REF);
    await waitFor(() => expect(screen.getByText(/Loaded/)).toBeTruthy());
    expect(setItem).not.toHaveBeenCalled();
    expect(sessionSetItem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('GenomeUpload — refused input is never echoed (SPEC §7.3)', () => {
  it('shows only the category and the generic reason, and discards the text', async () => {
    const onGenomeChange = vi.fn<(m: GenomeModel | null) => void>();
    const { container } = render(<GenomeUpload onGenomeChange={onGenomeChange} />);

    const sentinel = 'ZZQSENTINELQZZ';
    paste(`>HBB primer order ${sentinel}\n${HBB_REF}`);

    await waitFor(() => expect(screen.getByText(/Refused ·/)).toBeTruthy());
    expect(screen.getByText(/CONSTRUCT_DESIGN_REQUEST/)).toBeTruthy();
    // The policy's generic reason is shown.
    expect(screen.getByText(/never produces wet-lab constructs/i)).toBeTruthy();

    // Nothing the user submitted is anywhere in the rendered output.
    expect(container.textContent).not.toContain(sentinel);
    expect(container.textContent).not.toContain(HBB_REF);

    // The textarea is emptied, so the refused text is not even held in the form.
    const box = screen.getByLabelText<HTMLTextAreaElement>(/paste a coding sequence/i);
    expect(box.value).toBe('');

    // Nothing was handed downstream.
    expect(onGenomeChange).toHaveBeenLastCalledWith(null);
    // And nothing was persisted.
    expect(setItem).not.toHaveBeenCalled();
  });

  it('declines a gene with no curated reference instead of inventing one', async () => {
    // TP53 is on `FLAGGED_LOCI` but has no entry in `loci.json`, so there is
    // no reference allele to diff an upload against. The component says so
    // rather than fabricating a reference or a policy verdict.
    render(<GenomeUpload gene="TP53" />);
    paste(HBB_REF);
    await waitFor(() =>
      expect(screen.getByText(/no curated locus 'TP53'/i)).toBeTruthy(),
    );
    // This is a configuration problem, not a refusal, so the user keeps what
    // they typed and can change the gene. Nothing was handed downstream.
    const box = screen.getByLabelText<HTMLTextAreaElement>(/paste a coding sequence/i);
    expect(box.value).toBe(HBB_REF);
  });

  it('explains that the refused text was discarded, referencing it only by digest', async () => {
    render(<GenomeUpload />);
    paste(`>HBB primer order\n${HBB_REF}`);
    await waitFor(() => expect(screen.getByText(/Refused ·/)).toBeTruthy());
    expect(screen.getByText(/not stored, not logged and not shown back/i)).toBeTruthy();
  });
});

describe('GenomeUpload — escalation waits for a human (SPEC §7.5)', () => {
  it('holds the sequence behind an explicit acknowledgement', async () => {
    const onGenomeChange = vi.fn<(m: GenomeModel | null) => void>();
    render(<GenomeUpload onGenomeChange={onGenomeChange} />);
    paste(`>HBB germline correction\n${HBB_REF}`);

    await waitFor(() => expect(screen.getByText(/Held for review/)).toBeTruthy());
    expect(screen.getByText(/GERMLINE_HERITABLE/)).toBeTruthy();
    expect(screen.getByText(/institutional biosafety committee/i)).toBeTruthy();
    // Crucially: nothing applied yet.
    expect(onGenomeChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: /acknowledge and load/i }));
    await waitFor(() => expect(screen.getByText(/Loaded/)).toBeTruthy());
    const model = onGenomeChange.mock.calls.at(-1)?.[0];
    expect(model).not.toBeNull();
    expect(model?.gene).toBe('HBB');
  });
});

describe('GenomeUpload — friendly inline validation, never a stack trace', () => {
  it('names the offending character and its position for non-ACGT input (SPEC §4.6 #13)', async () => {
    render(<GenomeUpload />);
    paste('ATGNNNCCC');
    const alert = await screen.findByText(/only a, c, g and t are accepted/i);
    expect(alert.textContent).toContain('"N"');
    expect(alert.textContent).toMatch(/position 4/);
    // No stack trace, no error class name.
    expect(alert.textContent).not.toMatch(/InvalidBaseError|at Object|\.ts:/);
  });

  it('explains a trailing partial codon rather than truncating it (SPEC §4.6 #14)', async () => {
    render(<GenomeUpload />);
    paste('ATGGTGCA');
    await waitFor(() => expect(screen.getByText(/cannot be used/i)).toBeTruthy());
    const status = document.querySelector('[role="status"]');
    expect(status?.textContent).toMatch(/whole codons|multiple of 3|extra/i);
    expect(status?.textContent).not.toMatch(/PartialCodonError/);
  });

  it('reports an empty submission without throwing', () => {
    render(<GenomeUpload />);
    const box = screen.getByLabelText(/paste a coding sequence/i);
    fireEvent.change(box, { target: { value: '   ' } });
    // The button stays disabled rather than producing an error.
    expect(screen.getByRole('button', { name: /screen and load/i })).toHaveProperty(
      'disabled',
      true,
    );
  });
});
