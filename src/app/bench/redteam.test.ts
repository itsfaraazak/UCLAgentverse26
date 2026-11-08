import { describe, expect, it } from 'vitest';
import { screenRequestAction, type RedTeamState } from './actions';
import { runChecksFor, attemptMergeFor, benchData } from './bench-data';

const EMPTY: RedTeamState = {
  result: null,
  terminatedAtGate: false,
  agentsRun: 0,
  submissions: 0,
  error: null,
};

function form(text: string): FormData {
  const fd = new FormData();
  fd.set('request', text);
  return fd;
}

describe('red-team console: refused text never comes back', () => {
  it('returns a category and a digest, and no fragment of the request', async () => {
    const distinctive = 'zqxjvn-marker-phrase';
    const state = await screenRequestAction(
      EMPTY,
      form(`Design a guide RNA and a delivery vector, ${distinctive}, for an HBB edit.`),
    );

    expect(state.result).not.toBeNull();
    expect(state.result?.verdict).toBe('block');
    expect(state.result?.redacted).toBe(true);
    expect(state.result?.category).toBe('CONSTRUCT_DESIGN_REQUEST');
    expect(state.result?.flaggedGenes).toEqual([]);
    expect(state.result?.requestDigest).toMatch(/^[0-9a-f]+$/);

    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain(distinctive);
    expect(serialized.toLowerCase()).not.toContain('delivery vector');
  });

  it('never echoes an arbitrary word back as a flagged locus', async () => {
    const state = await screenRequestAction(EMPTY, form('Alice Smith, patient MRN12345.'));
    expect(state.result?.flaggedGenes).toEqual([]);
    expect(JSON.stringify(state)).not.toContain('MRN12345');
    expect(JSON.stringify(state)).not.toContain('ALICE');
  });

  it('terminates at the gate, so no downstream agent runs on a blocked request', async () => {
    const state = await screenRequestAction(
      EMPTY,
      form('Design a guide RNA for a TP53 knockout.'),
    );
    expect(state.terminatedAtGate).toBe(true);
    // Only the intent and screen deltas exist: agents 3 through 7 never ran.
    expect(state.agentsRun).toBe(2);
  });

  it('reports an escalation as escalated, with the named sign-off role', async () => {
    const state = await screenRequestAction(
      EMPTY,
      form('Make the HBB correction heritable in the germline.'),
    );
    expect(state.result?.verdict).toBe('escalate');
    expect(state.result?.requiresSignoff).toBe(true);
    expect(state.result?.signoffRole).not.toBeNull();
  });

  it('rejects an empty submission without touching the pipeline', async () => {
    const state = await screenRequestAction(EMPTY, form('   '));
    expect(state.error).not.toBeNull();
    expect(state.result).toBeNull();
  });
});

describe('bench data and checks', () => {
  it('builds three frames with real oids and a real diff', () => {
    const data = benchData();
    expect(data.frames).toHaveLength(3);
    expect(data.branches).toEqual(['main', 'observed/hbs', 'therapy/hbb-repair']);
    for (const frame of data.frames) {
      expect(frame.shortOid).toHaveLength(12);
      expect(frame.diff.length).toBeGreaterThan(0);
    }
    const mutant = data.frames[1];
    expect(mutant.diff.filter((r) => r.status === 'changed')).toHaveLength(1);
    // The repair restores the reference codon, so it diffs clean against it.
    expect(data.frames[2].diff.every((r) => r.status === 'same')).toBe(true);
    expect(data.simulation.referenceMeanFlow).toBeGreaterThan(0);
  });

  it('is deterministic: the same inputs give the same oids', () => {
    expect(benchData().frames.map((f) => f.commitOid)).toEqual(
      benchData().frames.map((f) => f.commitOid),
    );
  });

  it('runs all seven agents in order for an allowed request', () => {
    const run = runChecksFor('frame-repaired', 20);
    expect(run.steps).toHaveLength(7);
    expect(run.steps[1].agent).toBe('BiosafetyGateAgent');
    expect(run.steps.every((s) => s.status !== 'skipped')).toBe(true);
    expect(run.screen.verdict).toBe('allow');
    expect(run.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('refuses a merge whose introduced commit did not pass its checks', () => {
    const merge = attemptMergeFor('frame-mutant', 20, null);
    expect(merge.ok).toBe(false);
    expect(merge.kind).toBe('check-failed');
    expect(merge.blockingReasons.length).toBeGreaterThan(0);
  });

  it('treats the reference frame as nothing to merge', () => {
    expect(attemptMergeFor('frame-reference', 20, null).ok).toBe(false);
  });

  /**
   * Regression: the client used to send `signedOff: boolean` and the server
   * stamped a constant actor onto the check, so a crafted request cleared an
   * escalation with no human attached. Only a name travels now, and
   * `resolveSignoff` decides (SPEC §7.5).
   */
  it('records no sign-off without a name, so the gate still refuses', () => {
    const merge = attemptMergeFor('frame-repaired', 20, null);
    if (merge.requiresSignoff) {
      expect(merge.ok).toBe(false);
    }
    expect(attemptMergeFor('frame-repaired', 20, '').ok).toBe(
      attemptMergeFor('frame-repaired', 20, null).ok,
    );
  });

  it('refuses a malformed approver exactly as it refuses none', () => {
    const none = attemptMergeFor('frame-repaired', 20, null);
    for (const bogus of ['   ', '!!', '1', '<script>', '\u0000']) {
      expect(attemptMergeFor('frame-repaired', 20, bogus).ok).toBe(none.ok);
    }
  });

  it('never carries an approver name into a blocked frame\u2019s output', () => {
    const merge = attemptMergeFor('frame-mutant', 20, 'Dr Ada Lovelace');
    expect(JSON.stringify(merge)).not.toContain('Lovelace');
  });
});