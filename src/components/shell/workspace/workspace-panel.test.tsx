// @vitest-environment jsdom
/**
 * The Genome 3D and Upload tabs mount the real components, wired to the
 * branch's own data — and an upload stays out of the branch list.
 *
 * The 3D engine is never started here: `load-engine` is replaced with a
 * loader that never settles, so the helix stays in its own loading state and
 * no `three` or WebGL is touched. What is asserted is the wiring — which
 * genome the shell hands each component, what the tab says about it, and
 * that the gate note survives.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyVariant, loadLoci, referenceSequence, variantById } from '@/lib/genome';
import { buildWorkspace } from '../model/workspace';
import { branchNameForGenotype } from '../model/derive';
import type { BranchView, WorkspaceView } from '../model/types';
import { WorkspacePanel, type WorkspaceTab } from './workspace-panel';

vi.mock('@/components/genome-3d/load-engine', () => ({
  loadGenomeEngine: vi.fn(() => new Promise<never>(() => undefined)),
}));

// The diff and merge tabs call server actions; these tests never open them,
// but the module graph still imports them.
vi.mock('@/app/actions', () => ({
  screenRequestAction: vi.fn(() => new Promise<never>(() => undefined)),
  diffAction: vi.fn(() => new Promise<never>(() => undefined)),
  createBranchAction: vi.fn(() => new Promise<never>(() => undefined)),
  mergeProposalAction: vi.fn(() => new Promise<never>(() => undefined)),
}));

const locus = (() => {
  const first = loadLoci()[0];
  if (first === undefined) throw new Error('fixture has no loci');
  return first;
})();
const reference = referenceSequence(locus);

let workspace: WorkspaceView;

function branchNamed(name: string): BranchView {
  const branch = workspace.branches.find((b) => b.name === name);
  if (branch === undefined) throw new Error(`no branch ${name}`);
  return branch;
}

function renderTab(tab: WorkspaceTab, branch: BranchView) {
  return render(
    <WorkspacePanel
      locus={workspace.locus}
      branches={workspace.branches}
      branch={branch}
      overlay={[]}
      defaultBranch={workspace.defaultBranch}
      simulation={workspace.simulation}
      fixtureDisclaimer={workspace.fixtureDisclaimer}
      tab={tab}
      onTabChange={() => undefined}
    />,
  );
}

function stubMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

beforeEach(() => {
  workspace = buildWorkspace();
  stubMatchMedia();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Genome 3D tab', () => {
  it('mounts the helix, not a placeholder', () => {
    renderTab('genome3d', branchNamed(workspace.defaultBranch));
    const panel = screen.getByRole('tabpanel');

    expect(within(panel).queryByText(/mount point ready/i)).toBeNull();
    expect(within(panel).queryByText(/not yet present/i)).toBeNull();
    expect(
      within(panel).getByRole('heading', { name: `${locus.gene} coding region` }),
    ).toBeTruthy();
    // The component's own honesty disclosure is on screen.
    expect(within(panel).getByText(/not a predicted or deposited structure/i)).toBeTruthy();
  });

  it('draws main as the unedited reference rather than the first curated variant', () => {
    renderTab('genome3d', branchNamed(workspace.defaultBranch));
    const panel = screen.getByRole('tabpanel');

    expect(within(panel).getByText(/is the imported reference with no edit applied/i)).toBeTruthy();
    expect(within(panel).getByText(/no codon differs between the two sequences/i)).toBeTruthy();
  });

  it("surfaces a single-edit line's curated annotation and its limitation text", () => {
    const single = locus.genotypes.find((g) => g.appliedVariants.length === 1);
    const variant = variantById(locus, single?.appliedVariants[0] ?? '');
    if (single === undefined || variant === undefined) {
      throw new Error('fixture needs a single-edit genotype');
    }
    renderTab('genome3d', branchNamed(branchNameForGenotype(single.id)));
    const panel = screen.getByRole('tabpanel');

    expect(within(panel).getByText(/applies one curated edit to the reference/i)).toBeTruthy();
    const limitation = variant.structural.limitation;
    expect(limitation.length).toBeGreaterThan(0);
    expect(panel.textContent).toContain(limitation);
  });

  it('draws a compound line as its net change and says why no annotation applies', () => {
    const compound = locus.genotypes.find((g) => g.appliedVariants.length > 1);
    if (compound === undefined) throw new Error('fixture needs a compound genotype');
    renderTab('genome3d', branchNamed(branchNameForGenotype(compound.id)));
    const panel = screen.getByRole('tabpanel');

    expect(
      within(panel).getByText(
        new RegExp(`carries ${compound.appliedVariants.length} edits in its history`),
      ),
    ).toBeTruthy();
    expect(within(panel).getByText(/no single curated\s+annotation applies/i)).toBeTruthy();
  });
});

describe('Upload tab', () => {
  async function paste(value: string): Promise<void> {
    // The upload panel is lazy-loaded, so wait for the form to arrive.
    fireEvent.change(await screen.findByLabelText(/paste a coding sequence/i), {
      target: { value },
    });
    fireEvent.click(screen.getByRole('button', { name: /screen and load/i }));
  }

  /** The reference with one curated substitution, built through lib/genome. */
  function editedSequence(): string {
    const variant = locus.variants.find((v) => v.kind === 'substitution');
    if (variant === undefined) throw new Error('fixture needs a substitution');
    return applyVariant(reference, variant).bases;
  }

  it('mounts the upload form with the gate note, and no helix until something is accepted', async () => {
    renderTab('upload', branchNamed(workspace.defaultBranch));
    const panel = screen.getByRole('tabpanel');

    expect(await within(panel).findByLabelText(/paste a coding sequence/i)).toBeTruthy();
    expect(within(panel).queryByText(/mount point ready/i)).toBeNull();
    expect(
      within(panel).getByText(/does not become a branch and cannot reach a merge/i),
    ).toBeTruthy();
    expect(within(panel).getByText(/non-ACGT input is\s+rejected/i)).toBeTruthy();
    expect(within(panel).queryByRole('heading', { name: /coding region/ })).toBeNull();
  });

  it('draws an accepted upload, keeps the gate note, and adds no branch', async () => {
    const before = workspace.branches.map((b) => b.name);
    renderTab('upload', branchNamed(workspace.defaultBranch));
    await paste(`>my-copy\n${editedSequence()}`);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: `${locus.gene} coding region` })).toBeTruthy(),
    );
    expect(screen.getByText(/does not become a branch/i)).toBeTruthy();
    // The upload's codon change reaches the helix's text alternative.
    expect(screen.queryByText(/no codon differs/i)).toBeNull();
    // Nothing on this tab can create a branch: the workspace is unchanged.
    expect(workspace.branches.map((b) => b.name)).toEqual(before);
    expect(screen.queryByRole('button', { name: /branch|merge/i })).toBeNull();
  });

  it('draws nothing for a refused upload', async () => {
    renderTab('upload', branchNamed(workspace.defaultBranch));
    await paste(`>HBB primer order\n${reference.bases}`);

    await waitFor(() => expect(screen.getByText(/Refused ·/)).toBeTruthy());
    expect(screen.queryByRole('heading', { name: /coding region/ })).toBeNull();
    expect(screen.getByText(/does not become a branch/i)).toBeTruthy();
  });

  it('holds an escalated upload back from the helix until a human acknowledges it', async () => {
    renderTab('upload', branchNamed(workspace.defaultBranch));
    await paste(`>HBB germline correction\n${editedSequence()}`);

    await waitFor(() => expect(screen.getByText(/Held for review/)).toBeTruthy());
    expect(screen.queryByRole('heading', { name: /coding region/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /acknowledge and load anyway/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: `${locus.gene} coding region` })).toBeTruthy(),
    );
  });
});
