// @vitest-environment jsdom
/**
 * The shell's prop-resync contract.
 *
 * The workspace, the overlay and the selected branch were seeded from props
 * once and then never looked at the props again, so a `router.refresh()` or a
 * soft navigation back to `/` with new server data kept rendering the first
 * snapshot. That became load-bearing when created lines moved into the URL:
 * the server's answer to the `router.replace` *is* how a created line arrives.
 *
 * These tests drive the component through the seam a navigation drives it
 * through — a rerender with a different `workspace` object — and assert what
 * is on screen afterwards, including where the selection lands when the
 * selected line is not in the new snapshot.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildWorkspace } from './model/workspace';
import { encodeOverlay } from './model/overlay-url';
import type { BranchSpec, WorkspaceView } from './model/types';
import { createBranchAction } from '@/app/actions';
import { AppShell } from './app-shell';

const replace = vi.fn();
const push = vi.fn();

vi.mock('next/navigation', () => ({
  // The variant switcher in the titlebar reads the current params to carry
  // the overlay across surfaces; here the window has none.
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({
    replace,
    push,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// The 3D tab must never start the real engine in a test environment.
vi.mock('@/components/genome-3d/load-engine', () => ({
  loadGenomeEngine: vi.fn(() => new Promise<never>(() => undefined)),
}));

// The diff and merge tabs call server actions; these tests do not open them,
// but the module graph still imports them.
vi.mock('@/app/actions', () => ({
  screenRequestAction: vi.fn(() => new Promise<never>(() => undefined)),
  diffAction: vi.fn(() => new Promise<never>(() => undefined)),
  createBranchAction: vi.fn(() => new Promise<never>(() => undefined)),
  mergeProposalAction: vi.fn(() => new Promise<never>(() => undefined)),
}));

// jsdom ships no `matchMedia`, and `use-theme` reads it for the system
// preference. A fixed "light" answer is enough: the theme is not what these
// tests are about.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

const base = buildWorkspace();

const firstVariant = (() => {
  const id = base.variants.find((v) => v.variantId !== null)?.variantId;
  if (id === null || id === undefined) throw new Error('fixture has no variant');
  return id;
})();

const created: BranchSpec = {
  name: 'line/my-proposal',
  from: base.defaultBranch,
  variantId: firstVariant,
};
const withCreated: WorkspaceView = buildWorkspace([created]);

function rail() {
  return screen.getByRole('navigation', { name: 'Branches' });
}

function branchRow(name: string) {
  return within(rail()).getByRole('button', { name: new RegExp(name, 'i') });
}

function selectedBranchName(): string {
  const rows = within(rail())
    .getAllByRole('button')
    .filter((el) => el.getAttribute('aria-current') === 'true');
  const [row] = rows;
  if (row === undefined) throw new Error('no branch is marked current');
  if (rows.length > 1) throw new Error('more than one branch is marked current');
  const label = row.querySelector('.row__label')?.textContent;
  if (label === null || label === undefined) throw new Error('row carries no label');
  return label;
}

describe('the shell picks up a new server snapshot', () => {
  it('renders a created line that arrives as a prop, not just one it made', () => {
    const view = render(
      <AppShell workspace={base} overlay={[]} overlayNote={null} />,
    );
    expect(
      within(rail()).queryByRole('button', { name: /line\/my-proposal/i }),
    ).toBeNull();

    // What a soft navigation back to `/?line=…` hands the client.
    view.rerender(
      <AppShell workspace={withCreated} overlay={[created]} overlayNote={null} />,
    );

    expect(branchRow('line/my-proposal')).toBeDefined();
  });

  it('keeps the selection when the selected line survives the new snapshot', () => {
    const view = render(
      <AppShell workspace={withCreated} overlay={[created]} overlayNote={null} />,
    );
    const before = selectedBranchName();

    // A refresh of the same URL: same content, new object identity.
    view.rerender(
      <AppShell
        workspace={buildWorkspace([created])}
        overlay={[created]}
        overlayNote={null}
      />,
    );

    expect(selectedBranchName()).toBe(before);
  });

  it('falls back to a branch that exists when the selected line disappears', () => {
    const view = render(
      <AppShell workspace={withCreated} overlay={[created]} overlayNote={null} />,
    );

    // Select the created line, then hand over a snapshot without it — a
    // shared link that does not carry it, or a replay that dropped it.
    fireEvent.click(branchRow('line/my-proposal'));
    expect(selectedBranchName()).toBe('line/my-proposal');

    view.rerender(<AppShell workspace={base} overlay={[]} overlayNote={null} />);

    const after = selectedBranchName();
    expect(after).not.toBe('line/my-proposal');
    expect(base.branches.map((b) => b.name)).toContain(after);
    // Nothing renders from the vanished branch: the titlebar crumb follows.
    expect(screen.queryByText('line/my-proposal')).toBeNull();
  });

  it('carries the overlay into the Surfaces links', () => {
    render(
      <AppShell workspace={withCreated} overlay={[created]} overlayNote={null} />,
    );

    const link = within(rail()).getByRole('link', { name: /Lab bench/i });
    expect(link.getAttribute('href')).toBe(`/bench?${encodeOverlay([created])}`);
  });

  it('writes a created line into the URL, with replace rather than push', async () => {
    vi.mocked(createBranchAction).mockResolvedValue({
      workspace: withCreated,
      overlay: [created],
    });
    render(<AppShell workspace={base} overlay={[]} overlayNote={null} />);

    fireEvent.click(within(rail()).getByRole('button', { name: /New line/i }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: created.name },
    });
    fireEvent.change(screen.getByLabelText('Edit'), {
      target: { value: created.variantId },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));

    await waitFor(() => expect(replace).toHaveBeenCalled());
    const [[url]] = replace.mock.calls;
    expect(url).toBe(`/?${encodeOverlay([created])}`);
    // The back button must not collect one entry per created line.
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the degraded-link note when the server sends one', () => {
    render(
      <AppShell
        workspace={base}
        overlay={[]}
        overlayNote="1 created line in this link could not be restored (1 malformed)."
      />,
    );

    expect(screen.getByTestId('overlay-note').textContent).toContain(
      'could not be restored',
    );
  });
});
