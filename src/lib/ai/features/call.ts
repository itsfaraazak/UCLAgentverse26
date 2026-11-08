import '../server-only';
import type { ScreenInput, ScreenResult } from '@/lib/safety/policy';
import {
  assertTransmissible,
  mayTransmit,
  screenBeforeTransmit,
} from '../guard';
import { resolveProvider } from '../registry';
import { AiSchemaError } from '../json';
import {
  AiAuthError,
  AiError,
  AiMalformedResponseError,
  AiNotConfiguredError,
  AiOutputTooLargeError,
  AiRateLimitError,
  AiTimeoutError,
  DEFAULT_TIMEOUT_MS,
  type CompleteOptions,
  type Provider,
  type ProviderId,
} from '../types';

/**
 * Shared call plumbing for the three AI features.
 *
 * Every outbound request goes through `screen()` then `assertTransmissible`.
 * Provider failures become labelled degrade reasons rather than thrown
 * crashes or silent fake answers.
 */

export interface FeatureOptions {
  /** Injected provider (tests). When omitted, the registry default is used. */
  readonly provider?: Provider;
  readonly providerId?: ProviderId;
  readonly timeoutMs?: number;
  readonly maxOutputChars?: number;
  readonly signal?: AbortSignal;
}

export function featureProvider(options: FeatureOptions): Provider | undefined {
  if (options.provider !== undefined) {
    return options.provider.available() ? options.provider : undefined;
  }
  return resolveProvider(options.providerId);
}

export function completeOptions(
  options: FeatureOptions,
  maxOutputChars: number,
  system?: string,
): CompleteOptions {
  return {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputChars: options.maxOutputChars ?? maxOutputChars,
    signal: options.signal,
    temperature: 0,
    ...(system === undefined ? {} : { system }),
  };
}

export type CallOutcome =
  | {
      readonly kind: 'ok';
      readonly text: string;
      readonly provider: Provider;
      readonly lexical: ScreenResult;
    }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly lexical: ScreenResult }
  | { readonly kind: 'refused'; readonly lexical: ScreenResult }
  | { readonly kind: 'failed'; readonly reason: string; readonly lexical: ScreenResult };

export function describeFailure(err: unknown): string {
  if (err instanceof AiNotConfiguredError) return 'no provider configured';
  if (err instanceof AiTimeoutError) return 'timeout';
  if (err instanceof AiAuthError) return 'authentication rejected';
  if (err instanceof AiRateLimitError) return 'rate limited';
  if (err instanceof AiOutputTooLargeError) return 'output exceeds size cap';
  if (err instanceof AiMalformedResponseError) return 'malformed response';
  if (err instanceof AiSchemaError) return 'malformed output';
  if (err instanceof AiError) return 'provider error';
  return 'provider call failed';
}

/**
 * Screen, refuse redacted text, then call the provider. Never transmits
 * content whose `redacted` flag is set.
 */
export async function screenedComplete(
  screenInput: ScreenInput,
  prompt: string,
  options: FeatureOptions,
  caps: { readonly maxOutputChars: number; readonly system?: string },
): Promise<CallOutcome> {
  const lexical = screenBeforeTransmit(screenInput);

  if (!mayTransmit(lexical)) {
    return { kind: 'refused', lexical };
  }

  const provider = featureProvider(options);
  if (provider === undefined) {
    return { kind: 'unavailable', reason: 'no provider configured', lexical };
  }

  assertTransmissible(lexical);

  try {
    const text = await provider.complete(
      prompt,
      completeOptions(options, caps.maxOutputChars, caps.system),
    );
    return { kind: 'ok', text, provider, lexical };
  } catch (err) {
    return { kind: 'failed', reason: describeFailure(err), lexical };
  }
}
