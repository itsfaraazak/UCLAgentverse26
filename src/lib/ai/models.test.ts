import { describe, expect, it } from 'vitest';
import { GEMINI_MODEL, assertNotFlash } from './models';
import { createGeminiProvider } from './providers/gemini';

describe('GEMINI_MODEL', () => {
  it('is pinned to gemini-4-argon and is what the query-param HTTP provider uses', () => {
    expect(GEMINI_MODEL).toBe('gemini-4-argon');
    const provider = createGeminiProvider({ apiKey: 'test-key-not-used' });
    expect(provider.model).toBe('gemini-4-argon');
    expect(provider.model).toBe(GEMINI_MODEL);
  });

  it('refuses Flash (and other lite) substitutions', () => {
    expect(() => assertNotFlash('gemini-2.5-flash')).toThrow(/flash/);
    expect(() => assertNotFlash('gemini-3.5-flash')).toThrow(/flash/);
    expect(() => assertNotFlash('gemini-flash-lite')).toThrow();
    expect(assertNotFlash('gemini-4-argon')).toBe('gemini-4-argon');
  });
});
