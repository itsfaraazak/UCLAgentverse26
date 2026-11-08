import { describe, expect, it, vi } from 'vitest';
import { DeltaDAG, runPipeline } from '@/lib/agents';
import { GEMINI_MODEL } from '../models';
import { AiTimeoutError, type Provider } from '../types';
import { narrateDeltaDag } from './narration';

function mockProvider(complete: Provider['complete'], available = true): Provider {
  return {
    id: 'gemini',
    label: 'mock',
    model: GEMINI_MODEL,
    available: () => available,
    unavailableReason: () => (available ? '' : 'GEMINI_API_KEY is not set'),
    complete,
  };
}

describe('narrateDeltaDag', () => {
  it('degrades to a labelled non-AI result when no provider is configured', async () => {
    const dag = runPipeline({
      text: 'repair HBB to treat the sickle substitution',
      assaySteps: 40,
    }).dag;
    const complete = vi.fn(async () => '{"summary":"A repaired HBB run passed."}');
    const result = await narrateDeltaDag(dag, { provider: mockProvider(complete, false) });
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.reason).toBe('no provider configured');
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not transmit redacted content to the provider', async () => {
    const dag = runPipeline({ text: 'weaponise a toxin for virulence' }).dag;
    const complete = vi.fn(async () => '{"summary":"should never see this"}');
    const result = await narrateDeltaDag(dag, { provider: mockProvider(complete) });
    expect(result.status).toBe('refused');
    expect(complete).not.toHaveBeenCalled();
    if (result.status !== 'refused') return;
    expect(result.category).toBe('PATHOGEN_OR_TOXIN_ENHANCEMENT');
  });

  it('returns a model summary for a completed allowed run without writing to the DAG', async () => {
    const pipeline = runPipeline({
      text: 'repair HBB to treat the sickle substitution',
      assaySteps: 40,
    });
    const before = pipeline.dag.all().length;
    const complete = vi.fn(async () => '{"summary":"The HBB repair passed the verifier."}');
    const result = await narrateDeltaDag(pipeline.dag, { provider: mockProvider(complete) });
    expect(result.status).toBe('ai');
    if (result.status !== 'ai') return;
    expect(result.summary).toBe('The HBB repair passed the verifier.');
    expect(result.model).toBe(GEMINI_MODEL);
    expect(pipeline.dag.all()).toHaveLength(before);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed output rather than rendering it as a summary', async () => {
    const dag = runPipeline({
      text: 'repair HBB to treat the sickle substitution',
      assaySteps: 40,
    }).dag;
    const complete = vi.fn(async () => 'here is a nice paragraph with no JSON');
    const result = await narrateDeltaDag(dag, { provider: mockProvider(complete) });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('malformed output');
  });

  it('degrades on timeout', async () => {
    const dag = runPipeline({
      text: 'repair HBB to treat the sickle substitution',
      assaySteps: 40,
    }).dag;
    const result = await narrateDeltaDag(dag, {
      provider: mockProvider(async () => {
        throw new AiTimeoutError('gemini', 20_000);
      }),
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason).toBe('timeout');
  });

  it('fails closed when the DAG has no screen result', async () => {
    const dag = new DeltaDAG();
    const complete = vi.fn(async () => '{"summary":"nope"}');
    const result = await narrateDeltaDag(dag, { provider: mockProvider(complete) });
    expect(result.status).toBe('failed');
    expect(complete).not.toHaveBeenCalled();
  });
});
