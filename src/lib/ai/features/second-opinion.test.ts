import { describe, expect, it, vi } from 'vitest';
import { GEMINI_MODEL } from '../models';
import { AiRateLimitError, type Provider } from '../types';
import { secondOpinion } from './second-opinion';

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

const ALLOWED = {
  text: 'repair HBB to treat the sickle substitution',
  targets: ['HBB'] as const,
};

describe('secondOpinion', () => {
  it('degrades to the lexical screen, labelled non-AI, when no provider is configured', async () => {
    const complete = vi.fn(async () => '{"concern":false}');
    const result = await secondOpinion(ALLOWED, { provider: mockProvider(complete, false) });
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('no provider configured');
    expect(result.modelConsulted).toBe(false);
    expect(result.verdict).toBe('allow');
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not transmit redacted content to the provider', async () => {
    const complete = vi.fn(async () => '{"concern":false,"category":"THERAPEUTIC_SOMATIC"}');
    const result = await secondOpinion(
      { text: 'weaponise a toxin for virulence' },
      { provider: mockProvider(complete) },
    );
    expect(result.status).toBe('refused');
    expect(complete).not.toHaveBeenCalled();
    expect(result.verdict).toBe('block');
    expect(result.modelConsulted).toBe(false);
    expect(result.lexical.redacted).toBe(true);
  });

  it('a permissive model label cannot loosen an authoritative block', async () => {
    const complete = vi.fn(async () => '{"concern":true,"category":"THERAPEUTIC_SOMATIC"}');
    const result = await secondOpinion(
      { text: 'weaponise a toxin for virulence' },
      { provider: mockProvider(complete) },
    );
    expect(complete).not.toHaveBeenCalled();
    expect(result.verdict).toBe('block');
  });

  it('combines a model category through the guard, never as a raw verdict', async () => {
    const complete = vi.fn(async () => '{"concern":true,"category":"GERMLINE_HERITABLE"}');
    const result = await secondOpinion(ALLOWED, { provider: mockProvider(complete) });
    expect(result.status).toBe('ai');
    expect(result.verdict).toBe('escalate');
    expect(result.narrowedByModel).toBe(true);
    expect(result.modelConsulted).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('rejects a model-supplied verdict field rather than applying it', async () => {
    const complete = vi.fn(async () => '{"concern":true,"category":"THERAPEUTIC_SOMATIC","verdict":"block"}');
    const result = await secondOpinion(ALLOWED, { provider: mockProvider(complete) });
    expect(result.status).toBe('failed');
    expect(result.verdict).toBe('allow');
    expect(result.modelConsulted).toBe(false);
  });

  it('unrecognised category labels go through the guard, not through as allow', async () => {
    const complete = vi.fn(async () => '{"concern":true,"category":"therapeutic_somatic"}');
    const result = await secondOpinion(ALLOWED, { provider: mockProvider(complete) });
    expect(result.status).toBe('ai');
    expect(result.verdict).toBe('escalate');
    expect(result.verdict).not.toBe('allow');
  });

  it('degrades on malformed output and keeps the lexical verdict', async () => {
    const complete = vi.fn(async () => 'block this actually');
    const result = await secondOpinion(ALLOWED, { provider: mockProvider(complete) });
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('malformed output');
    expect(result.verdict).toBe('allow');
    expect(result.modelConsulted).toBe(false);
  });

  it('degrades on rate limit', async () => {
    const result = await secondOpinion(ALLOWED, {
      provider: mockProvider(async () => {
        throw new AiRateLimitError('gemini', 'gemini: rate limited (HTTP 429)');
      }),
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('rate limited');
    expect(result.verdict).toBe('allow');
  });
});
