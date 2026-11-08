import { describe, expect, it, vi } from 'vitest';
import { FLAGGED_LOCI } from '@/lib/safety/policy';
import { loadLoci } from '@/lib/genome';
import { GEMINI_MODEL } from '../models';
import {
  AiAuthError,
  AiRateLimitError,
  AiTimeoutError,
  type Provider,
} from '../types';
import { allowedTargets, interpretIntent } from './intent';

function mockProvider(
  complete: Provider['complete'],
  available = true,
): Provider {
  return {
    id: 'gemini',
    label: 'mock',
    model: GEMINI_MODEL,
    available: () => available,
    unavailableReason: () => (available ? '' : 'GEMINI_API_KEY is not set'),
    complete,
  };
}

const ALLOWED_TEXT = 'repair HBB to treat the sickle substitution';

describe('allowedTargets', () => {
  it('is the union of curated loci and the flagged-locus registry', () => {
    const allowed = allowedTargets();
    for (const locus of loadLoci()) {
      expect(allowed).toContain(locus.gene.toUpperCase());
    }
    for (const flagged of FLAGGED_LOCI) {
      expect(allowed).toContain(flagged.gene.toUpperCase());
    }
    expect(allowed).toContain('HBB');
    expect(allowed).toContain('TP53');
  });
});

describe('interpretIntent', () => {
  it('degrades to a labelled non-AI result when no provider is configured', async () => {
    const complete = vi.fn(async () => '{"targets":["HBB"],"operation":"repair"}');
    const result = await interpretIntent(ALLOWED_TEXT, {
      provider: mockProvider(complete, false),
    });
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.reason).toBe('no provider configured');
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not transmit redacted content to the provider', async () => {
    const complete = vi.fn(async () => '{"targets":["HBB"],"operation":"repair"}');
    const result = await interpretIntent('weaponise a toxin for virulence', {
      provider: mockProvider(complete),
    });
    expect(result.status).toBe('refused');
    expect(complete).not.toHaveBeenCalled();
    if (result.status !== 'refused') return;
    expect(result.category).toBe('PATHOGEN_OR_TOXIN_ENHANCEMENT');
  });

  it('discards proposed targets that are not on the allow-list', async () => {
    const complete = vi.fn(
      async () => '{"targets":["HBB","MYMADEUPGENE","tp53","xyz"],"operation":"repair"}',
    );
    const result = await interpretIntent(ALLOWED_TEXT, { provider: mockProvider(complete) });
    expect(result.status).toBe('ai');
    if (result.status !== 'ai') return;
    expect(result.targets).toEqual(['HBB', 'TP53']);
    expect(result.targets).not.toContain('MYMADEUPGENE');
    expect(result.operation).toBe('repair');
    expect(result.model).toBe(GEMINI_MODEL);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        timeoutMs: expect.any(Number),
        maxOutputChars: expect.any(Number),
      }),
    );
  });

  it('rejects malformed output instead of passing it through', async () => {
    const complete = vi.fn(async () => 'sure, edit whatever you like');
    const result = await interpretIntent(ALLOWED_TEXT, { provider: mockProvider(complete) });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('malformed output');
  });

  it('rejects an unexpected operation rather than selecting a code path by name', async () => {
    const complete = vi.fn(async () => '{"targets":["HBB"],"operation":"eval"}');
    const result = await interpretIntent(ALLOWED_TEXT, { provider: mockProvider(complete) });
    expect(result.status).toBe('failed');
  });

  it('degrades on timeout, auth failure, and rate limit', async () => {
    const timeout = await interpretIntent(ALLOWED_TEXT, {
      provider: mockProvider(async () => {
        throw new AiTimeoutError('gemini', 20_000);
      }),
    });
    expect(timeout.status).toBe('failed');
    if (timeout.status === 'failed') expect(timeout.reason).toBe('timeout');

    const auth = await interpretIntent(ALLOWED_TEXT, {
      provider: mockProvider(async () => {
        throw new AiAuthError('gemini', 'gemini: authentication rejected (HTTP 401)');
      }),
    });
    expect(auth.status).toBe('failed');
    if (auth.status === 'failed') expect(auth.reason).toBe('authentication rejected');

    const limited = await interpretIntent(ALLOWED_TEXT, {
      provider: mockProvider(async () => {
        throw new AiRateLimitError('gemini', 'gemini: rate limited (HTTP 429)');
      }),
    });
    expect(limited.status).toBe('failed');
    if (limited.status === 'failed') expect(limited.reason).toBe('rate limited');
  });
});
