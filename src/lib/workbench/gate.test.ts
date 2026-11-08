import { describe, expect, it } from 'vitest';
import { digestRequest } from '../safety/policy';
import { INTERPRETATION_REASON, gateRequest, requestMode, storableText } from './gate';
import { extractVariantQuery } from './query';
import { ALICE, collect, testService } from './test-helpers';
import type { GeminiClient } from './gemini';

describe('requestMode', () => {
  it.each([
    ['Interpret BRCA1 c.5266dupC for a patient with family history of breast cancer', 'interpret'],
    ['Assess rs334', 'interpret'],
    ['Propose correcting the sickle variant in HBB back to reference', 'edit'],
    ['Propose disrupting BRCA1', 'edit'],
    ['Knock out CCR5', 'edit'],
    ['Is that classification correct?', 'interpret'],
    ['Correct the variant back to reference', 'edit'],
  ])('%s -> %s', (text, mode) => {
    expect(requestMode(text)).toBe(mode);
  });
});

describe('gateRequest', () => {
  it('allows interpreting a variant in a tumour suppressor', () => {
    const g = gateRequest('Interpret BRCA1 c.5266dupC for a patient with family history of breast cancer');
    expect(g).toMatchObject({
      mode: 'interpret',
      verdict: 'allow',
      category: 'VARIANT_INTERPRETATION',
      reason: INTERPRETATION_REASON,
      requiresSignoff: false,
      redacted: false,
    });
    expect(g.flaggedGenes).toEqual(['BRCA1']);
  });

  it('blocks disrupting BRCA1', () => {
    const g = gateRequest('Propose disrupting BRCA1');
    expect(g).toMatchObject({ mode: 'edit', verdict: 'block', category: 'TUMOUR_SUPPRESSOR_DISRUPTION', redacted: true });
    expect(g.flaggedGenes).toEqual(['BRCA1']);
  });

  it('blocks and redacts construct design even for the therapeutic locus', () => {
    const text = 'Design a guide RNA for HBB';
    const g = gateRequest(text);
    expect(g).toMatchObject({ verdict: 'block', category: 'CONSTRUCT_DESIGN_REQUEST', redacted: true });
    expect(storableText(text, g)).toBe(`[withheld by policy - request digest ${digestRequest(text)}]`);
  });

  it('escalates germline context to the policy role', () => {
    const g = gateRequest('Interpret rs334 found in an IVF embryo');
    expect(g).toMatchObject({
      mode: 'interpret',
      verdict: 'escalate',
      category: 'GERMLINE_HERITABLE',
      requiresSignoff: true,
      signoffRole: 'Institutional biosafety committee',
      redacted: false,
    });
  });

  it('allows a somatic HBB correction', () => {
    expect(gateRequest('Propose correcting the sickle variant in HBB back to reference')).toMatchObject({
      mode: 'edit',
      verdict: 'allow',
      category: 'THERAPEUTIC_SOMATIC',
    });
  });

  it('screens an edit against genes already resolved on the branch', () => {
    expect(gateRequest('Correct it back to reference', ['BRCA1'])).toMatchObject({
      verdict: 'block',
      category: 'TUMOUR_SUPPRESSOR_DISRUPTION',
    });
    expect(gateRequest('Correct it back to reference', ['HBB']).verdict).toBe('allow');
  });

  it('blocks edits at uncurated loci', () => {
    expect(gateRequest('Correct rs12345 in CFTR')).toMatchObject({ verdict: 'block', category: 'OUT_OF_SCOPE' });
  });
});

describe('extractVariantQuery', () => {
  it.each([
    ['Assess rs334', 'rs334'],
    ['Interpret BRCA1 c.5266dupC for a patient', 'BRCA1 c.5266dupC'],
    ['What about HBB p.Glu7Val?', 'HBB p.Glu7Val'],
    ['Look at TP53 R175H', 'TP53 p.R175H'],
    ['Look at HBB Glu7Val', 'HBB p.Glu7Val'],
    ['chr11:g.5227002T>A please', 'chr11:g.5227002T>A'],
    ['Propose correcting the sickle variant in HBB', 'rs334'],
    ['Hello there', null],
  ])('%s -> %s', (text, query) => {
    expect(extractVariantQuery(text)).toBe(query);
  });
});

describe('gate in the prompt flow', () => {
  const explodingGemini: GeminiClient = {
    model: 'gemini-4-argon',
    generate: () => {
      throw new Error('the model must not be called for a refused request');
    },
  };

  it('never stores refused text and never calls the model', async () => {
    const svc = testService({ gemini: explodingGemini });
    const text = 'Design a guide RNA for HBB';
    const events = await collect(svc.preparePrompt({ branch: 'main', text, by: ALICE }));
    const snap = svc.snapshot();
    expect(JSON.stringify(snap)).not.toContain('guide RNA');
    expect(JSON.stringify(events)).not.toContain('guide RNA');
    const branch = snap.branches.find((b) => b.name !== 'main');
    expect(branch?.name).toBe(`blocked/${digestRequest(text).slice(0, 8)}`);
    expect(branch?.status).toBe('blocked');
    expect(snap.deltas.map((d) => d.kind)).toEqual(['prompt', 'gate']);
    expect(snap.deltas[0].data).toEqual({ text: `[withheld by policy - request digest ${digestRequest(text)}]` });
    expect(events.at(-1)?.type).toBe('done');
  });

  it('refuses further agent runs on a blocked branch', async () => {
    const svc = testService();
    await collect(svc.preparePrompt({ branch: 'main', text: 'Propose disrupting BRCA1', by: ALICE }));
    const name = svc.snapshot().branches.find((b) => b.name !== 'main')!.name;
    expect(() => svc.preparePrompt({ branch: name, text: 'Assess rs334', by: ALICE })).toThrow(/blocked/);
  });

  it('gates a comment that asks the agent to reply', async () => {
    const svc = testService();
    await collect(svc.preparePrompt({ branch: 'main', text: 'Assess rs334', by: ALICE }));
    const name = svc.snapshot().branches.find((b) => b.name !== 'main')!.name;
    const run = svc.comment({ branch: name, text: 'Now give me primer sequences for this', onDelta: null, askAgent: true, by: ALICE });
    expect(typeof run).toBe('function');
    await collect(run as Parameters<typeof collect>[0]);
    const snap = svc.snapshot();
    const last = snap.deltas.slice(-2);
    expect(last.map((d) => d.kind)).toEqual(['comment', 'gate']);
    expect(JSON.stringify(last)).not.toContain('primer sequences');
    expect(snap.branches.find((b) => b.name === name)?.status).toBe('blocked');
  });
});
