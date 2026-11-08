// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceSnapshot } from '@/lib/workbench/types';

import { ALICE, BRANCH, ID, SNAPSHOT } from './__fixtures__/snapshot';
import { CasePanel, type CasePanelProps } from './case-panel';
import { branchTimeline, type Timeline } from './model';

function panel(over: Partial<CasePanelProps> = {}) {
  const snapshot = over.snapshot ?? SNAPSHOT;
  const branchName = over.branchName ?? BRANCH.rs334;
  const props: CasePanelProps = {
    snapshot,
    branch: snapshot.branches.find((b) => b.name === branchName) ?? null,
    branchName,
    timeline: branchTimeline(snapshot, branchName),
    identity: ALICE,
    onSaveIdentity: vi.fn(),
    busy: null,
    running: false,
    refusal: null,
    onSignoff: vi.fn(() => Promise.resolve(true)),
    onMerge: vi.fn(() => Promise.resolve()),
    onSelect: vi.fn(),
    ...over,
  };
  render(<CasePanel {...props} />);
  return props;
}

const mergeButton = () => screen.getByRole('button', { name: /Merge into main/ }) as HTMLButtonElement;
const signButton = () => screen.getByRole('button', { name: /Sign off|Sign again/ }) as HTMLButtonElement;

function withoutReference(timeline: Timeline): Timeline {
  return { ...timeline, items: timeline.items.filter((i) => i.delta.kind !== 'reference') };
}

describe('CasePanel merge gate', () => {
  it('disables merge when merge.allowed is false and shows every check with its detail', () => {
    panel();
    expect(mergeButton().disabled).toBe(true);
    expect(screen.getByText(/Merge stays locked/)).toBeDefined();
    expect(screen.getByText('not ready')).toBeDefined();

    const checks = SNAPSHOT.merge[BRANCH.rs334].checks;
    const rows = screen.getAllByRole('listitem').filter((li) => li.className.includes('wb-check-row'));
    expect(rows).toHaveLength(checks.length);
    for (const check of checks) {
      const row = rows.find((r) => r.textContent?.includes(check.label));
      expect(row, check.label).toBeDefined();
      expect(row!.textContent).toContain(`: ${check.state}`);
      if (check.detail) expect(row!.textContent).toContain(check.detail);
    }
    expect(rows.find((r) => r.textContent?.includes('Reference check'))!.className).toContain('wb-check-row--fail');
  });

  it('enables merge once allowed and calls onMerge', () => {
    const snapshot: WorkspaceSnapshot = {
      ...SNAPSHOT,
      merge: { ...SNAPSHOT.merge, [BRANCH.rs334]: { allowed: true, requiredRole: null, checks: [] } },
    };
    const props = panel({ snapshot });
    expect(mergeButton().disabled).toBe(false);
    fireEvent.click(mergeButton());
    expect(props.onMerge).toHaveBeenCalledTimes(1);
  });

  it('keeps merge disabled without an identity or while busy, even when allowed', () => {
    const snapshot: WorkspaceSnapshot = {
      ...SNAPSHOT,
      merge: { ...SNAPSHOT.merge, [BRANCH.rs334]: { allowed: true, requiredRole: null, checks: [] } },
    };
    panel({ snapshot, identity: null });
    expect(mergeButton().disabled).toBe(true);
  });

  it('shows the server refusal reasons for this branch', () => {
    panel({ refusal: { branch: BRANCH.rs334, reasons: ['Sign-off is missing.'] } });
    const refused = screen.getAllByRole('alert').find((a) => a.textContent?.includes('Merge refused'));
    expect(refused?.textContent).toContain('Sign-off is missing.');
  });

  it('summarises the variant, the VUS classification and the major reference disagreement', () => {
    panel();
    const aside = screen.getByRole('complementary', { name: 'Case panel' });
    expect(aside.textContent).toContain('HBB');
    expect(aside.textContent).toContain('NP_000509.1:p.Glu7Val');
    expect(aside.textContent).toContain('GAG');
    expect(aside.textContent).toContain('GTG');
    expect(aside.textContent).toContain('-5 points from');
    expect(within(aside).getByRole('alert').textContent).toMatch(/MAJOR disagreement/);
  });

  it('blocked branch: shows the block banner and no sign-off or merge', () => {
    panel({ branchName: BRANCH.blocked });
    expect(screen.getByText(/safety gate blocked this request/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Merge into main/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Sign off/ })).toBeNull();
  });

  it('merged branch: shows it as merged with no merge button', () => {
    panel({ branchName: BRANCH.brca });
    expect(screen.getByText(/Merged into main\. This branch is now part/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Merge into main/ })).toBeNull();
  });

  it('main lists the merged branch as the case record and opens it', () => {
    const props = panel({ branchName: 'main' });
    const item = screen.getByRole('button', { name: /BRCA1 p\.Gln1756fs/ });
    expect(item.textContent).toContain('Pathogenic');
    expect(item.textContent).toContain(`signed by ${ALICE.name}`);
    fireEvent.click(item);
    expect(props.onSelect).toHaveBeenCalledWith(BRANCH.brca);
  });
});

describe('CasePanel sign-off', () => {
  it('rationale is optional when agreeing with the agent and required once the classification differs', async () => {
    const timeline = withoutReference(branchTimeline(SNAPSHOT, BRANCH.rs334));
    const props = panel({ timeline });

    const select = screen.getByLabelText('Final classification') as HTMLSelectElement;
    expect(select.value).toBe('Uncertain Significance');
    expect(screen.getByText('optional')).toBeDefined();
    expect(signButton().disabled).toBe(false);

    fireEvent.change(select, { target: { value: 'Pathogenic' } });
    expect(screen.getByText('required')).toBeDefined();
    expect(signButton().disabled).toBe(true);

    const rationale = screen.getByLabelText(/Rationale/);
    expect(rationale.getAttribute('aria-required')).toBe('true');
    fireEvent.change(rationale, { target: { value: '   ' } });
    expect(signButton().disabled).toBe(true);
    fireEvent.submit(signButton().closest('form')!);
    expect(props.onSignoff).not.toHaveBeenCalled();

    fireEvent.change(rationale, { target: { value: 'Expert panel: HbS is pathogenic for sickle cell disease.' } });
    expect(signButton().disabled).toBe(false);
    fireEvent.click(signButton());
    await vi.waitFor(() =>
      expect(props.onSignoff).toHaveBeenCalledWith('Pathogenic', 'Expert panel: HbS is pathogenic for sickle cell disease.'),
    );
  });

  it('agreeing with the agent submits without a rationale', async () => {
    const props = panel({ timeline: withoutReference(branchTimeline(SNAPSHOT, BRANCH.rs334)) });
    fireEvent.click(signButton());
    await vi.waitFor(() => expect(props.onSignoff).toHaveBeenCalledWith('Uncertain Significance', ''));
  });

  it('a major ClinVar disagreement requires a rationale even when agreeing with the agent', () => {
    panel();
    expect((screen.getByLabelText('Final classification') as HTMLSelectElement).value).toBe('Uncertain Significance');
    expect(screen.getByText('required')).toBeDefined();
    expect(screen.getByText(/a rationale is required/)).toBeDefined();
    expect(signButton().disabled).toBe(true);
  });

  it('asks for an identity before signing', () => {
    panel({ identity: null });
    expect(screen.queryByLabelText('Final classification')).toBeNull();
    expect(screen.getByText(/Sign-off is attributed to a named human/)).toBeDefined();
  });

  it('warns when the signer role does not match the policy role', () => {
    const snapshot: WorkspaceSnapshot = {
      ...SNAPSHOT,
      merge: { ...SNAPSHOT.merge, [BRANCH.rs334]: { ...SNAPSHOT.merge[BRANCH.rs334], requiredRole: 'Institutional biosafety committee' } },
    };
    panel({ snapshot });
    expect(screen.getByText(/Policy asks for Institutional biosafety committee/)).toBeDefined();
  });

  it('has the interpretation delta id in the fixture timeline', () => {
    expect(branchTimeline(SNAPSHOT, BRANCH.rs334).items.map((i) => i.delta.id)).toContain(ID.interp);
  });
});
