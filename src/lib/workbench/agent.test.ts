import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAgent, type AgentTrigger } from './agent';
import type { StreamEvent } from './api-types';
import { createGeminiClient } from './gemini';
import { WorkbenchStore } from './store';
import { fakeEvidence } from './test-helpers';
import type { AnyDelta } from './types';

const KEY = 'test-key-SECRET-123';

interface Captured {
  bodies: Record<string, unknown>[];
  urls: string[];
}

function geminiResponse(parts: unknown[]): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A scripted Gemini endpoint: each call returns the next response. */
function scriptedFetch(script: (() => Response | Promise<Response>)[], captured: Captured): typeof fetch {
  let i = 0;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured.urls.push(String(url));
    captured.bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const step = script[i++];
    if (step === undefined) throw new Error('unexpected extra model call');
    return step();
  }) as typeof fetch;
}

function setup() {
  const store = new WorkbenchStore({ file: null });
  store.createBranch({ name: 'review/rs334', title: 'Assess rs334', from: { branch: 'main', delta: null }, by: { kind: 'human', name: 'A', role: null } });
  const prompt = store.append('review/rs334', {
    kind: 'prompt',
    actor: { kind: 'human', name: 'A', role: null },
    title: 'Assess rs334',
    data: { text: 'Assess rs334' },
  });
  const events: StreamEvent[] = [];
  const trigger: AgentTrigger = { kind: 'prompt', text: 'Assess rs334', deltaId: prompt.id, mode: 'interpret', author: 'A' };
  return { store, events, emit: (e: StreamEvent) => events.push(e), trigger };
}

function kinds(store: WorkbenchStore): string[] {
  return store.ancestry('review/rs334').map((d) => d.kind);
}

function last(store: WorkbenchStore, kind: string): AnyDelta {
  return store.ancestry('review/rs334').filter((d) => d.kind === kind).at(-1)!;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runAgent with Gemini', () => {
  it('runs tools in parallel, echoes thought signatures and records the final answer', async () => {
    const { store, emit, events, trigger } = setup();
    const evidence = fakeEvidence(20);
    const captured: Captured = { bodies: [], urls: [] };
    const turn1 = [
      { text: 'Plan: look up the variant and search the literature.', thoughtSignature: 'sig-plan' },
      { functionCall: { name: 'lookup_variant', args: { query: 'rs334' }, id: 'call-1' }, thoughtSignature: 'sig-1' },
      { functionCall: { name: 'search_literature', args: { query: 'HBB Glu7Val sickle' }, id: 'call-2' } },
    ];
    const fetchImpl = scriptedFetch(
      [() => geminiResponse(turn1), () => geminiResponse([{ text: 'Sickle variant; ClinVar says Pathogenic.' }])],
      captured,
    );
    const gemini = createGeminiClient({ apiKey: KEY, fetchImpl });
    await runAgent({ branch: 'review/rs334', trigger, emit, evidence, store, gemini });

    expect(evidence.maxInFlight).toBeGreaterThanOrEqual(2);
    expect(captured.bodies).toHaveLength(2);
    const contents = captured.bodies[1].contents as { role: string; parts: Record<string, unknown>[] }[];
    expect(contents[1]).toEqual({ role: 'model', parts: turn1 });
    expect(contents[2].role).toBe('user');
    const responses = contents[2].parts.map((p) => p.functionResponse as { name: string; id: string; response: Record<string, unknown> });
    expect(responses.map((r) => [r.name, r.id])).toEqual([
      ['lookup_variant', 'call-1'],
      ['search_literature', 'call-2'],
    ]);
    expect(responses[0].response).toMatchObject({ acmg: expect.any(Object), clinvar: { consensus: 'Pathogenic' } });
    expect(captured.bodies[0].systemInstruction).toBeDefined();
    expect((captured.bodies[0].tools as { functionDeclarations: unknown[] }[])[0].functionDeclarations).toHaveLength(3);

    const order = kinds(store);
    expect(order.slice(0, 2)).toEqual(['prompt', 'plan']);
    expect([...order.slice(2, 6)].sort()).toEqual(['evidence', 'interpretation', 'literature', 'reference']);
    expect(order.indexOf('evidence')).toBeLessThan(order.indexOf('interpretation'));
    expect(order.indexOf('interpretation')).toBeLessThan(order.indexOf('reference'));
    expect(order.at(-1)).toBe('message');
    expect(last(store, 'message').actor).toEqual({ kind: 'agent', name: 'Gemini analyst', model: 'gemini-4-argon' });
    expect(last(store, 'evidence').actor).toEqual({ kind: 'agent', name: 'Evidence agent', model: null });
    expect(last(store, 'interpretation').actor).toEqual({ kind: 'agent', name: 'ACMG classifier', model: null });
    expect(last(store, 'reference').actor).toEqual({ kind: 'agent', name: 'ClinVar reference check', model: null });
    expect(events.filter((e) => e.type === 'delta')).toHaveLength(6);
    expect(events.some((e) => e.type === 'progress' && /gemini-4-argon/.test(e.message))).toBe(true);
  });

  it('falls back to the deterministic pipeline when the model is rate limited', async () => {
    const { store, emit, events, trigger } = setup();
    const evidence = fakeEvidence();
    const captured: Captured = { bodies: [], urls: [] };
    const fetchImpl = scriptedFetch([() => new Response(`quota exceeded for key ${KEY}`, { status: 429 })], captured);
    await runAgent({ branch: 'review/rs334', trigger, emit, evidence, store, gemini: createGeminiClient({ apiKey: KEY, fetchImpl }) });

    expect(kinds(store)).toEqual(['prompt', 'error', 'plan', 'evidence', 'interpretation', 'reference', 'literature', 'message']);
    const error = last(store, 'error');
    expect(error.data).toMatchObject({ recoverable: true });
    expect(error.body).toMatch(/rate limited/);
    expect(JSON.stringify(store.allDeltas())).not.toContain(KEY);
    expect(JSON.stringify(events)).not.toContain(KEY);
    expect(last(store, 'message').actor).toEqual({ kind: 'agent', name: 'Deterministic pipeline', model: null });
    expect(evidence.calls.literature[0]).toContain('HBB');
  });

  it('reuses evidence already fetched when the model fails mid-run', async () => {
    const { store, emit, trigger } = setup();
    const evidence = fakeEvidence();
    const captured: Captured = { bodies: [], urls: [] };
    const fetchImpl = scriptedFetch(
      [
        () => geminiResponse([{ functionCall: { name: 'lookup_variant', args: { query: 'rs334' }, id: 'c1' } }]),
        () => {
          throw new TypeError(`fetch failed for https://x/?key=${KEY}`);
        },
      ],
      captured,
    );
    await runAgent({ branch: 'review/rs334', trigger, emit, evidence, store, gemini: createGeminiClient({ apiKey: KEY, fetchImpl }) });
    expect(evidence.calls.resolve).toEqual(['rs334']);
    expect(kinds(store)).toEqual(['prompt', 'evidence', 'interpretation', 'reference', 'error', 'plan', 'literature', 'message']);
    expect(JSON.stringify(store.allDeltas())).not.toContain(KEY);
  });

  it('times out a hung model call and falls back', async () => {
    const { store, emit, trigger } = setup();
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    await runAgent({
      branch: 'review/rs334',
      trigger,
      emit,
      evidence: fakeEvidence(),
      store,
      gemini: createGeminiClient({ apiKey: KEY, fetchImpl: hang, timeoutMs: 50 }),
    });
    expect(last(store, 'error').body).toMatch(/did not answer/);
    expect(last(store, 'message').actor).toMatchObject({ name: 'Deterministic pipeline' });
  });

  it('runs only the deterministic pipeline when forced', async () => {
    vi.stubEnv('WORKBENCH_FORCE_FALLBACK', '1');
    const { store, emit, trigger } = setup();
    const captured: Captured = { bodies: [], urls: [] };
    const gemini = createGeminiClient({ apiKey: KEY, fetchImpl: scriptedFetch([], captured) });
    await runAgent({ branch: 'review/rs334', trigger, emit, evidence: fakeEvidence(), store, gemini });
    expect(captured.bodies).toHaveLength(0);
    expect(last(store, 'error').body).toMatch(/WORKBENCH_FORCE_FALLBACK/);
    expect(last(store, 'message').actor).toMatchObject({ name: 'Deterministic pipeline' });
  });
});

describe('deterministic pipeline', () => {
  it('proposes and screens a correction in edit mode', async () => {
    const { store, emit } = setup();
    const text = 'Propose correcting the sickle variant in HBB back to reference';
    const prompt = store.append('review/rs334', { kind: 'prompt', actor: { kind: 'human', name: 'A', role: null }, title: text, data: { text } });
    await runAgent({
      branch: 'review/rs334',
      trigger: { kind: 'prompt', text, deltaId: prompt.id, mode: 'edit', author: 'A' },
      emit,
      evidence: fakeEvidence(),
      store,
      gemini: null,
    });
    const edit = last(store, 'edit');
    expect(edit.data).toMatchObject({
      gene: 'HBB',
      codon: { position: 7, from: 'GTG', to: 'GAG' },
      aminoAcid: { from: 'Val', to: 'Glu' },
      gate: { verdict: 'allow', category: 'THERAPEUTIC_SOMATIC' },
    });
  });

  it('asks for a variant when none can be extracted', async () => {
    const { store, emit } = setup();
    const text = 'What do you think?';
    const prompt = store.append('review/rs334', { kind: 'prompt', actor: { kind: 'human', name: 'A', role: null }, title: text, data: { text } });
    await runAgent({
      branch: 'review/rs334',
      trigger: { kind: 'prompt', text, deltaId: prompt.id, mode: 'interpret', author: 'A' },
      emit,
      evidence: fakeEvidence(),
      store,
      gemini: null,
    });
    const msg = last(store, 'message');
    expect((msg.data as { markdown: string }).markdown).toMatch(/rsID/);
  });

  it('refuses a correction tool call in interpretation mode', async () => {
    const { store, emit, trigger } = setup();
    const captured: Captured = { bodies: [], urls: [] };
    const fetchImpl = scriptedFetch(
      [
        () => geminiResponse([{ functionCall: { name: 'propose_correction', args: {}, id: 'c1' } }]),
        () => geminiResponse([{ text: 'Done.' }]),
      ],
      captured,
    );
    await runAgent({ branch: 'review/rs334', trigger, emit, evidence: fakeEvidence(), store, gemini: createGeminiClient({ apiKey: KEY, fetchImpl }) });
    const responses = (captured.bodies[1].contents as { parts: { functionResponse?: { response: { error?: string } } }[] }[])[2].parts;
    expect(responses[0].functionResponse?.response.error).toMatch(/only available for edit/);
    expect(kinds(store)).not.toContain('edit');
  });
});
