// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { AnyDelta, WbDeltaKind } from '@/lib/workbench/types';

import { BLOCK_GATE, BLOCKED_ORIGINAL, ID, PAPERS, SNAPSHOT, deltaById } from './__fixtures__/snapshot';
import { DeltaCard, type CardContext } from './delta-card';

const KINDS: readonly WbDeltaKind[] = [
  'prompt',
  'gate',
  'plan',
  'evidence',
  'interpretation',
  'reference',
  'literature',
  'edit',
  'message',
  'comment',
  'assertion',
  'signoff',
  'merge',
  'error',
];

function ctx(over: Partial<CardContext> = {}): CardContext {
  return {
    knownIds: SNAPSHOT.deltas.map((d) => d.id),
    timelineIds: new Set(SNAPSHOT.deltas.map((d) => d.id)),
    redactedPrompts: new Set([ID.blockedPrompt]),
    onJump: vi.fn(),
    canAct: true,
    canAssert: true,
    actions: { comment: vi.fn(() => Promise.resolve(true)), fork: vi.fn(() => Promise.resolve(true)), assert: vi.fn(() => Promise.resolve(true)) },
    ...over,
  };
}

function bare(kind: WbDeltaKind, data: unknown, over: Partial<AnyDelta> = {}): AnyDelta {
  return {
    id: `f${KINDS.indexOf(kind).toString(16).padStart(15, '0')}`,
    seq: 1,
    branch: 'review/x',
    kind,
    actor: { kind: 'agent', name: 'Agent', model: null },
    title: `${kind} card`,
    body: '',
    data,
    parents: [],
    at: '2026-11-08T09:00:00.000Z',
    sources: [],
    ...over,
  } as AnyDelta;
}

let warn: MockInstance;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

const FALLBACK = /details could not be displayed/;

describe('DeltaCard', () => {
  it('renders every fixture delta with its details', () => {
    for (const d of SNAPSHOT.deltas) {
      const { unmount } = render(<DeltaCard delta={d} inherited={false} ctx={ctx()} />);
      expect(screen.getByRole('article')).toBeDefined();
      expect(screen.queryByText(FALLBACK)).toBeNull();
      unmount();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(KINDS)('%s card survives null data without falling back', (kind) => {
    render(<DeltaCard delta={bare(kind, null)} inherited={false} ctx={ctx()} />);
    expect(screen.getByRole('article').getAttribute('data-kind')).toBe(kind);
    expect(screen.queryByText(FALLBACK)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('survives partial data and missing parents/sources/actor', () => {
    const partial: [WbDeltaKind, unknown][] = [
      ['gate', { verdict: 'allow' }],
      ['plan', { steps: [] }],
      ['evidence', { evidence: { variant: null, protein: { refAa: 'E', altAa: null, position: null, refCodon: null, altCodon: null } } }],
      ['interpretation', { interpretation: { classification: 'Uncertain Significance' } }],
      ['reference', { comparison: { severity: 'major' } }],
      ['literature', { result: { papers: [{ pmid: null, title: 'Untitled link', url: '' }] } }],
      ['edit', { gene: 'HBB' }],
      ['signoff', { finalClassification: 'Benign', agreesWithAgent: false }],
      ['assertion', { kind: 'segregation', value: false, reason: '' }],
      ['error', { message: '' }],
    ];
    for (const [kind, data] of partial) {
      const d = bare(kind, data, { parents: undefined, sources: undefined, actor: undefined } as unknown as Partial<AnyDelta>);
      const { unmount } = render(<DeltaCard delta={d} inherited ctx={ctx()} />);
      expect(screen.getByRole('article')).toBeDefined();
      expect(screen.queryByText(FALLBACK)).toBeNull();
      unmount();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('contains a body that throws behind the card boundary', () => {
    const hostile = bare('plan', { steps: { length: 1 } });
    render(<DeltaCard delta={hostile} inherited={false} ctx={ctx()} />);
    expect(screen.getByRole('article')).toBeDefined();
    expect(screen.getByText(FALLBACK)).toBeDefined();
  });

  it('shows the rs334 evidence: frequency, AlphaMissense and the GAG>GTG codon change', () => {
    render(<DeltaCard delta={deltaById(ID.evidence)} inherited={false} ctx={ctx()} />);
    const card = screen.getByRole('article');
    expect(card.textContent).toContain('HBB');
    expect(card.textContent).toContain('rs334');
    expect(card.textContent).toContain('1.27%');
    expect(card.textContent).toContain('1 in 79');
    expect(card.textContent).toContain('0.227');
    const protein = within(card).getByLabelText('Protein change');
    expect(protein.textContent).toContain('GAG');
    expect(protein.textContent).toContain('GTG');
    expect(protein.querySelector('.wb-base--changed')?.textContent).toBe('T');
    expect(within(card).getByRole('img', { name: /AlphaMissense 0\.227, likely benign/ })).toBeDefined();
  });

  it('shows the VUS interpretation with BS1 and BP4 met at -5, and dismissing BS1 asks for a reason', async () => {
    const c = ctx();
    render(<DeltaCard delta={deltaById(ID.interp)} inherited={false} ctx={c} />);
    const card = screen.getByRole('article');
    expect(card.textContent).toContain('Uncertain Significance');
    expect(card.textContent).toContain('-5 points');
    const metRows = [...card.querySelectorAll('tr[data-met]')].map((r) => r.querySelector('td')?.textContent);
    expect(metRows.sort()).toEqual(['BP4', 'BS1']);

    const dismissButtons = within(card).getAllByRole('button', { name: /Dismiss$/ });
    expect(dismissButtons).toHaveLength(2);
    fireEvent.click(dismissButtons[0]);
    const submit = within(card).getByRole('button', { name: /^Dismiss BS1$/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(card).getByLabelText('Why should BS1 not apply?'), { target: { value: 'Malaria selection' } });
    fireEvent.click(submit);
    await vi.waitFor(() => expect(c.actions.assert).toHaveBeenCalledWith({ kind: 'dismiss', code: 'BS1', reason: 'Malaria selection' }));
  });

  it('hides human actions when assertions are not allowed (main, merged)', () => {
    render(<DeltaCard delta={deltaById(ID.interp)} inherited ctx={ctx({ canAssert: false })} />);
    expect(screen.queryByRole('button', { name: /Dismiss$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /segregation/ })).toBeNull();
  });

  it('flags the MAJOR ClinVar disagreement with 2 review stars', () => {
    render(<DeltaCard delta={deltaById(ID.reference)} inherited={false} ctx={ctx()} />);
    const card = screen.getByRole('article');
    expect(card.getAttribute('data-tone')).toBe('block');
    expect(within(card).getByRole('alert').textContent).toMatch(/MAJOR disagreement/);
    expect(within(card).getByRole('img', { name: '2 of 4 review stars' })).toBeDefined();
    expect(card.textContent).toContain('Pathogenic');
  });

  it('lists literature with Europe PMC links', () => {
    render(<DeltaCard delta={deltaById(ID.literature)} inherited={false} ctx={ctx()} />);
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('https://europepmc.org/article/'));
    expect(links.map((a) => a.textContent)).toEqual(PAPERS.papers.map((p) => p.title));
    expect(screen.getByText(/PMID 29542687/)).toBeDefined();
  });

  it('renders the agent message as markdown with jumpable delta refs', () => {
    const c = ctx();
    render(<DeltaCard delta={deltaById(ID.message)} inherited={false} ctx={c} />);
    fireEvent.click(screen.getByTitle(`Show delta ${ID.reference}`));
    expect(c.onJump).toHaveBeenCalledWith(ID.reference);
  });

  it('shows the human comment, attributed, and links to the delta it is on', () => {
    const c = ctx();
    render(<DeltaCard delta={deltaById(ID.comment)} inherited={false} ctx={c} />);
    const card = screen.getByRole('article');
    expect(card.textContent).toContain('Dr Alice Hart');
    expect(card.textContent).toContain('Clinical scientist');
    expect(card.querySelector('strong')?.textContent).toBe('BS1');
    fireEvent.click(within(card.querySelector<HTMLElement>('.wb-comment')!).getByRole('button', { name: ID.interp.slice(0, 8) }));
    expect(c.onJump).toHaveBeenCalledWith(ID.interp);
  });

  it('shows the blocked gate verdict and the redaction', () => {
    render(<DeltaCard delta={deltaById(ID.blockedGate)} inherited={false} ctx={ctx()} />);
    const card = screen.getByRole('article');
    expect(card.getAttribute('data-tone')).toBe('block');
    expect(card.textContent).toContain('Blocked');
    expect(card.textContent).toContain('Disrupting a gene that protects against cancer');
  });

  it('shows the merge delta on main and jumps to the merged head', () => {
    const c = ctx();
    render(<DeltaCard delta={deltaById(ID.merge)} inherited={false} ctx={c} />);
    const body = screen.getByText(/merged at/);
    expect(body.textContent).toContain('review/brca1-c-5266dupc');
    fireEvent.click(within(body).getByRole('button', { name: ID.brcaSignoff.slice(0, 8) }));
    expect(c.onJump).toHaveBeenCalledWith(ID.brcaSignoff);
  });
});

describe('redacted prompt', () => {
  /** Even if the original text leaked into a delta, a redacted prompt must not echo it anywhere. */
  const leaky = {
    ...deltaById(ID.blockedPrompt),
    title: BLOCKED_ORIGINAL,
    body: BLOCKED_ORIGINAL,
    data: { text: BLOCKED_ORIGINAL },
  } as AnyDelta;

  it('never shows the original text, in content, labels or the fork title', () => {
    const { container } = render(<DeltaCard delta={leaky} inherited={false} ctx={ctx()} />);
    const card = screen.getByRole('article');
    expect(card.getAttribute('aria-label')).toBe('Prompt: withheld by policy');
    expect(card.textContent).toContain('Prompt withheld by policy');

    fireEvent.click(screen.getByRole('button', { name: /Fork from here/ }));
    expect((screen.getByLabelText('New branch title') as HTMLInputElement).value).toBe('Alternative to: withheld prompt');

    expect(container.innerHTML).not.toContain(BLOCKED_ORIGINAL);
    expect(document.body.innerHTML).not.toContain(BLOCKED_ORIGINAL);
  });

  it('shows the stored prompt when it is not redacted', () => {
    render(<DeltaCard delta={leaky} inherited={false} ctx={ctx({ redactedPrompts: new Set() })} />);
    expect(screen.getByRole('article').textContent).toContain(BLOCKED_ORIGINAL);
  });

  it('the fixture gate is the one that marks it redacted', () => {
    expect(BLOCK_GATE.redacted).toBe(true);
    expect(deltaById(ID.blockedGate).parents).toEqual([ID.blockedPrompt]);
  });
});
