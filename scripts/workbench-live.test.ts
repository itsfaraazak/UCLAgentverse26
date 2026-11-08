import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEvidenceService } from '@/lib/evidence';
import type { StreamEvent } from '@/lib/workbench/api-types';
import { aiStatus, createGeminiClient } from '@/lib/workbench/gemini';
import { WorkbenchService } from '@/lib/workbench/service';
import { WorkbenchStore } from '@/lib/workbench/store';

/**
 * Live smoke test against the real Gemini API and evidence sources.
 * Run: pnpm vitest run --config vitest.scripts.config.mts workbench-live
 */

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const by = { name: 'Dr Live Test', role: 'Clinical scientist' };

async function run(text: string) {
  const svc = new WorkbenchService({
    store: new WorkbenchStore({ file: null }),
    evidence: () => createEvidenceService(),
    gemini: () => createGeminiClient(),
    ai: aiStatus,
  });
  const started = Date.now();
  const timeline: string[] = [];
  const events: StreamEvent[] = [];
  await svc.preparePrompt({ branch: 'main', text, by })((e) => {
    events.push(e);
    const t = ((Date.now() - started) / 1000).toFixed(1).padStart(5);
    if (e.type === 'progress') timeline.push(`${t}s progress  ${e.message}`);
    if (e.type === 'delta') timeline.push(`${t}s ${e.delta.kind.padEnd(14)} ${e.delta.actor.name}: ${e.delta.title}`);
    if (e.type === 'error') timeline.push(`${t}s STREAM ERROR ${e.message}`);
  });
  const snap = svc.snapshot();
  console.log(`\n=== ${text}\n${timeline.join('\n')}\ntotal ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const message = snap.deltas.filter((d) => d.kind === 'message').at(-1);
  if (message?.kind === 'message') console.log(`--- final message (${message.actor.name}) ---\n${message.data.markdown}`);
  return { snap, events };
}

describe('workbench worst case: no model, no network', () => {
  const offline = new WorkbenchService({
    store: new WorkbenchStore({ file: null }),
    evidence: () => createEvidenceService({ offline: true, cacheDir: null }),
    gemini: () => null,
    ai: () => ({ available: false, model: 'gemini-4-argon', reason: 'offline test' }),
  });

  it.each(['Assess rs334', 'Interpret BRCA1 c.5266dupC', 'Is CFTR p.Phe508del pathogenic?', 'TP53 p.Arg175His'])(
    'completes "%s" from the shipped cache',
    async (text) => {
      await offline.preparePrompt({ branch: 'main', text, by })(() => {});
      const snap = offline.snapshot();
      const branch = snap.branches.at(-1);
      const kinds = snap.deltas.filter((d) => d.branch === branch?.name).map((d) => d.kind);
      expect(kinds).toEqual(expect.arrayContaining(['gate', 'evidence', 'interpretation', 'reference', 'message']));
      const message = snap.deltas.filter((d) => d.kind === 'message').at(-1);
      expect(message?.actor).toMatchObject({ name: 'Deterministic pipeline', model: null });
    },
  );
});

describe.skipIf(!process.env.GEMINI_API_KEY)('workbench live', () => {
  it('interprets BRCA1 c.5266dupC with gemini-4-argon', async () => {
    const { snap } = await run('Interpret BRCA1 c.5266dupC for a patient with family history of breast cancer');
    const kinds = snap.deltas.map((d) => d.kind);
    expect(kinds).toContain('interpretation');
    expect(kinds).toContain('reference');
    const message = snap.deltas.filter((d) => d.kind === 'message').at(-1);
    expect(message?.actor).toMatchObject({ name: 'Gemini analyst', model: 'gemini-4-argon' });
  });

  it('proposes correcting the sickle variant', async () => {
    const { snap } = await run('Propose correcting the sickle variant in HBB back to reference');
    expect(snap.deltas.some((d) => d.kind === 'edit')).toBe(true);
  });
});
