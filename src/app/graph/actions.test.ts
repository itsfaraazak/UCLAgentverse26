/**
 * The `/graph` server-action boundary.
 *
 * Every action on this surface replays the client's whole `SessionState` to
 * rebuild the history, so that state is attacker-controlled input on *each*
 * call — not only on the one action that happens to validate it. `signOff`
 * shape-checked the approver; `loadScenario` and `attemptMerge` did not, so a
 * client posting to them directly bypassed the check and the length bound.
 * These tests pin the guard at all three entry points.
 *
 * What the guard does and does not do: it constrains the signature to a name
 * *shape* and 120 characters. It cannot tell a name from a sentence made of
 * letters, so it is a bound on what can be stored and rendered, not proof of
 * authorship. The same pattern guards `/`, `/ide` and `/bench`, so this is
 * parity with those surfaces rather than a stronger claim.
 */

import { describe, expect, it } from 'vitest';
import { attemptMerge, loadScenario, signOff } from './actions';

const ESCALATED = 'escalate/germline-inherited-repair';
const REFUSED = 'refused/tp53-disruption';

/** A name of the shape the gate accepts. */
const REAL_NAME = 'A. Reviewer';

/**
 * Not a name: punctuation and digits, and far past the 120-character bound.
 * This is the shape of pasted request text, which §7.3 keeps off the surface.
 */
const NOT_A_NAME = `url(javascript:0) 90210 <b>transmissibility</b> ${'x'.repeat(200)}`;

const state = (signoffs: readonly { branch: string; by: string }[]) => ({
  appliedMerges: [],
  signoffs,
});

describe('/graph — the approver guard holds at every entry point', () => {
  it('refuses it at signOff, as it always did', async () => {
    const result = await signOff(state([]), ESCALATED, NOT_A_NAME);
    expect(result.ok).toBe(false);
  });

  it('drops it when it arrives through loadScenario instead', async () => {
    const view = await loadScenario(state([{ branch: ESCALATED, by: NOT_A_NAME }]));
    expect(view.signoffs).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('javascript:0');
    // The escalation is therefore still held: no commit carries a sign-off.
    expect(view.commits.every((c) => c.run?.signoff == null)).toBe(true);
  });

  it('does not let it clear the merge hold through attemptMerge', async () => {
    const outcome = await attemptMerge(state([{ branch: ESCALATED, by: NOT_A_NAME }]), {
      into: 'main',
      from: ESCALATED,
    });
    expect(outcome.kind).toBe('blocked');
    expect(JSON.stringify(outcome)).not.toContain('javascript:0');
  });

  it('bounds a valid-shaped but overlong name rather than replaying it whole', async () => {
    const long = `${REAL_NAME}${' and co.'.repeat(60)}`;
    const view = await loadScenario(state([{ branch: ESCALATED, by: long }]));
    for (const s of view.signoffs) expect(s.by.length).toBeLessThanOrEqual(120);
  });

  it('still accepts a well-formed name arriving through the session state', async () => {
    // One call, not two: `attemptMerge`'s clean arm carries the rebuilt
    // scenario, so both halves of the positive control — the sign-off is
    // recorded, and it clears the hold — come from a single scenario build.
    // Building twice made this the slowest test in the suite by a wide
    // margin, because each build runs the ten-agent classified pipeline for
    // every branch, simulation included.
    const merged = await attemptMerge(state([{ branch: ESCALATED, by: REAL_NAME }]), {
      into: 'main',
      from: ESCALATED,
    });
    expect(merged.kind).toBe('clean');
    if (merged.kind !== 'clean') return;
    expect(merged.scenario.signoffs.map((s) => s.by)).toEqual([REAL_NAME]);
  });

  it('derives the sign-off role from policy, never from the client', async () => {
    const result = await signOff(state([]), ESCALATED, REAL_NAME);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.role).toBe('institutional_biosafety_committee');
  });

  it('refuses a sign-off on a refused branch however it arrives', async () => {
    // A refusal has no sign-off role, so nothing can clear it (SPEC §7.5).
    const direct = await signOff(state([]), REFUSED, REAL_NAME);
    expect(direct.ok).toBe(false);

    const replayed = await attemptMerge(state([{ branch: REFUSED, by: REAL_NAME }]), {
      into: 'main',
      from: REFUSED,
    });
    expect(replayed.kind).toBe('blocked');
  });
});
