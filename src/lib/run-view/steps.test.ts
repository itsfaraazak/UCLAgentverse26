import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { runPipeline } from '@/lib/agents';
import { AGENT_ORDER, PIPELINE_STEPS, agentDeltaKind, agentRole } from './steps';
import { runView } from './index';

/**
 * `steps.ts` exists so a client component can describe the pipeline without
 * importing a value from `lib/agents`, which reaches `lib/safety/policy` and
 * `node:crypto`. Two things therefore need pinning: that it stays free of that
 * dependency, and that it still describes the pipeline that actually runs.
 */

const SOURCE = readFileSync(fileURLToPath(new URL('./steps.ts', import.meta.url)), 'utf8');

/** Comments explain why this module exists and name the modules it avoids. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('steps.ts stays safe to ship to a browser', () => {
  it('imports no value from lib/agents, lib/safety, lib/vcs or node:crypto', () => {
    // Type-only imports are erased at build time, so they are allowed; a
    // value import from any of these would bundle the policy module.
    const valueImports = [...CODE.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map(
      (match) => match[1],
    );
    expect(valueImports).toEqual([]);
    for (const forbidden of ['node:crypto', 'lib/safety', 'lib/vcs']) {
      expect(CODE).not.toContain(forbidden);
    }
  });
});

describe('steps.ts describes the pipeline that runs', () => {
  it('is the seven agents of SPEC §4.3 with the gate second', () => {
    expect(PIPELINE_STEPS).toHaveLength(7);
    expect(PIPELINE_STEPS.map((spec) => spec.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(PIPELINE_STEPS[1]?.agent).toBe('BiosafetyGateAgent');
    expect(PIPELINE_STEPS[1]?.kind).toBe('screen');
  });

  it('matches the agents and kinds a real run emits', () => {
    const view = runView(runPipeline({ text: 'repair HBB to treat the sickle substitution' }));
    expect(AGENT_ORDER).toEqual(view.steps.map((step) => step.agent));
    expect(PIPELINE_STEPS.map((spec) => spec.kind)).toEqual(view.steps.map((step) => step.kind));
  });

  it('gives every agent a role and a resolvable delta kind', () => {
    for (const spec of PIPELINE_STEPS) {
      expect(agentRole(spec.agent).length).toBeGreaterThan(0);
      expect(agentDeltaKind(spec.agent)).toBe(spec.kind);
    }
  });

  it('returns empty rather than throwing for a name it does not know', () => {
    expect(agentRole('NoSuchAgent')).toBe('');
    expect(agentDeltaKind('NoSuchAgent')).toBeUndefined();
  });
});
