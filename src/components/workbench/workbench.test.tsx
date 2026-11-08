// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALICE, BLOCKED_ORIGINAL, BRANCH, ID, PROMPT_TEXT, SNAPSHOT } from './__fixtures__/snapshot';
import { Workbench } from './workbench';

const IDENTITY_KEY = 'sigmafold.workbench.identity';

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  fetchMock.mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/workbench') return Promise.resolve(json(SNAPSHOT));
    return Promise.resolve(json({ error: `unexpected ${url}` }, 500));
  });
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(ALICE));
  window.history.replaceState(null, '', '/');
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  window.localStorage.clear();
});

const rail = () => screen.getByRole('navigation', { name: 'Branches' });
const timeline = () => screen.getByRole('region', { name: 'Timeline' });
const branchRow = (text: RegExp) => within(rail()).getByRole('button', { name: text });

async function loaded() {
  await screen.findByRole('navigation', { name: 'Branches' });
}

describe('Workbench', () => {
  it('loads the snapshot from GET /api/workbench and opens on main', async () => {
    render(<Workbench />);
    expect(screen.getByRole('status').textContent).toMatch(/Loading the workspace/);
    await loaded();

    expect(fetchMock).toHaveBeenCalledWith('/api/workbench', { cache: 'no-store' });
    expect(within(rail()).getAllByRole('button').filter((b) => b.className === 'wb-branch')).toHaveLength(SNAPSHOT.branches.length);
    expect(branchRow(/^main/).getAttribute('aria-current')).toBe('true');
    expect(within(timeline()).getByRole('heading', { level: 2 }).textContent).toContain('main');
    expect(within(timeline()).getAllByRole('article')).toHaveLength(1);
    expect(within(timeline()).getByRole('article').getAttribute('data-kind')).toBe('merge');
    expect(document.querySelector('.wb-identity-btn__name')?.textContent).toBe(ALICE.name);
  });

  it('selecting a branch shows its timeline and case panel', async () => {
    render(<Workbench />);
    await loaded();

    fireEvent.click(branchRow(/Assess rs334/));
    await waitFor(() => expect(branchRow(/Assess rs334/).getAttribute('aria-current')).toBe('true'));
    expect(window.location.search).toBe(`?branch=${encodeURIComponent(BRANCH.rs334)}`);

    const cards = within(timeline()).getAllByRole('article');
    expect(cards.map((c) => c.getAttribute('data-kind'))).toEqual([
      'prompt',
      'gate',
      'plan',
      'evidence',
      'interpretation',
      'reference',
      'literature',
      'message',
      'comment',
    ]);
    expect(cards[0].textContent).toContain(PROMPT_TEXT);
    expect(within(timeline()).getByRole('heading', { level: 2 }).textContent).toContain(BRANCH.rs334);

    const aside = screen.getByRole('complementary', { name: 'Case panel' });
    expect(aside.textContent).toContain('Uncertain Significance');
    expect((within(aside).getByRole('button', { name: /Merge into main/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a delta ref in the agent message scrolls to that card', async () => {
    render(<Workbench />);
    await loaded();
    fireEvent.click(branchRow(/Assess rs334/));
    const ref = await within(timeline()).findByTitle(`Show delta ${ID.reference}`);
    fireEvent.click(ref);
    const target = document.getElementById(`delta-${ID.reference}`)!;
    expect(target.classList.contains('wb-flash')).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  it('the blocked branch never shows the original request', async () => {
    render(<Workbench />);
    await loaded();
    fireEvent.click(branchRow(/Withheld request/));
    await waitFor(() => expect(within(timeline()).getByRole('heading', { level: 2 }).textContent).toContain(BRANCH.blocked));

    const [prompt, gate] = within(timeline()).getAllByRole('article');
    expect(prompt.textContent).toContain('Prompt withheld by policy');
    expect(gate.textContent).toContain('Blocked');
    expect(document.body.textContent).not.toContain(BLOCKED_ORIGINAL);
  });

  it('opens on the branch named in the URL', async () => {
    window.history.replaceState(null, '', `/?branch=${encodeURIComponent(BRANCH.brca)}`);
    render(<Workbench />);
    await loaded();
    await waitFor(() => expect(within(timeline()).getByRole('heading', { level: 2 }).textContent).toContain(BRANCH.brca));
    expect(within(timeline()).getAllByRole('article').map((c) => c.getAttribute('data-kind'))).toContain('signoff');
  });

  it('shows a retryable error when the snapshot fails to load', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ error: 'Store unavailable' }, 500)));
    render(<Workbench />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Store unavailable');

    fetchMock.mockImplementation(() => Promise.resolve(json(SNAPSHOT)));
    fireEvent.click(within(alert).getByRole('button', { name: /Retry/ }));
    await loaded();
  });

  it('asks who you are instead of showing the composer when no identity is stored', async () => {
    window.localStorage.clear();
    render(<Workbench />);
    await loaded();
    expect(within(timeline()).queryByLabelText(/Prompt on/)).toBeNull();
    expect(within(timeline()).getByText(/Who is reviewing/)).toBeDefined();
  });
});
