import './server-only';
import { readSetting } from './server-only';
import { createGeminiProvider } from './providers/gemini';
import { createAnthropicProvider } from './providers/anthropic';
import { createOpenAiCompatibleProvider } from './providers/openai-compatible';
import { createCliProvider } from './providers/cli';
import type { Provider, ProviderId } from './types';

/**
 * Provider selection.
 *
 * Config comes from the environment; the UI picker passes an explicit id for
 * the same set. `SIGMAFOLD_AI_PROVIDER` chooses the default. Per-provider keys:
 *
 *   gemini             GEMINI_API_KEY
 *   anthropic          ANTHROPIC_API_KEY   (+ ANTHROPIC_MODEL)
 *   openai-compatible  OPENAI_API_KEY      (+ OPENAI_BASE_URL, OPENAI_MODEL)
 *   cli                SIGMAFOLD_AI_CLI    (a local `claude` / `cursor-agent`)
 *
 * None of these is a `NEXT_PUBLIC_*` name, and `readSecret` refuses such names
 * outright, so no key can reach the browser through this path.
 */

export const PROVIDER_IDS: readonly ProviderId[] = Object.freeze([
  'gemini',
  'anthropic',
  'openai-compatible',
  'cli',
]);

export function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.some((id) => id === value);
}

function construct(id: ProviderId): Provider {
  switch (id) {
    case 'gemini':
      return createGeminiProvider();
    case 'anthropic':
      return createAnthropicProvider();
    case 'openai-compatible':
      return createOpenAiCompatibleProvider();
    case 'cli':
      return createCliProvider();
  }
}

/**
 * Build a provider by id.
 *
 * Construction can throw — `assertNotFlash` does, for a misconfigured Gemini
 * model — so this returns the error rather than letting a bad env var take out
 * the whole picker.
 */
export function tryCreateProvider(id: ProviderId): Provider | Error {
  try {
    return construct(id);
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

export interface ProviderStatus {
  readonly id: ProviderId;
  readonly label: string;
  readonly model: string;
  readonly available: boolean;
  /** Empty when available. Safe to render: never contains a key. */
  readonly reason: string;
}

/**
 * Describe every provider for the UI picker.
 *
 * Deliberately returns a plain serialisable summary, not the providers
 * themselves: the picker runs in the browser and must receive no closure that
 * captured a key.
 */
export function providerStatuses(): readonly ProviderStatus[] {
  return PROVIDER_IDS.map((id) => {
    const created = tryCreateProvider(id);
    if (created instanceof Error) {
      return { id, label: id, model: 'unknown', available: false, reason: created.message };
    }
    return {
      id,
      label: created.label,
      model: created.model,
      available: created.available(),
      reason: created.unavailableReason(),
    };
  });
}

/** The configured default id, or `'gemini'`. */
export function configuredProviderId(): ProviderId {
  const configured = readSetting('SIGMAFOLD_AI_PROVIDER');
  if (configured !== undefined && isProviderId(configured)) {
    return configured;
  }
  return 'gemini';
}

/**
 * Resolve the provider to use for a call, or `undefined` when none is usable.
 *
 * Returning `undefined` rather than throwing is the point: "no AI available"
 * is a normal, expected state that every feature must handle by degrading to a
 * labelled non-AI result. There is deliberately **no** automatic failover to a
 * different provider — a caller asks for one backend and either gets it or
 * gets nothing, so the audit trail can always name what answered.
 */
export function resolveProvider(preferred?: ProviderId): Provider | undefined {
  const id = preferred ?? configuredProviderId();
  const created = tryCreateProvider(id);
  if (created instanceof Error) return undefined;
  return created.available() ? created : undefined;
}
