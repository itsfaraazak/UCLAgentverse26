import './server-only';

/**
 * BYOK provider harness — the contract every backend implements.
 *
 * The whole point of this layer is that *nothing above it knows which model
 * answered*, and nothing above it is allowed to trust the answer. Model output
 * is untrusted data: it comes back as a plain string, and every caller parses
 * it strictly before use (see `./json`).
 */

/** A provider's stable identifier, used in config and the UI picker. */
export type ProviderId = 'gemini' | 'anthropic' | 'openai-compatible' | 'cli';

export interface CompleteOptions {
  /**
   * Hard wall-clock budget for the call, in milliseconds. The provider must
   * abort the request when it elapses rather than hanging a request handler.
   */
  readonly timeoutMs?: number;
  /** Upper bound on generated tokens, passed to the backend where supported. */
  readonly maxOutputTokens?: number;
  /**
   * Upper bound on the returned string, in characters. Enforced locally by
   * every provider, because a backend's token limit is advisory and a
   * surprise 10 MB body should not reach a JSON parser.
   */
  readonly maxOutputChars?: number;
  /** Lower is more deterministic. Providers that cannot set it ignore it. */
  readonly temperature?: number;
  /** System / developer instruction, where the backend has a slot for one. */
  readonly system?: string;
  /** Caller-supplied cancellation, combined with the timeout. */
  readonly signal?: AbortSignal;
}

export interface Provider {
  readonly id: ProviderId;
  /** Human-readable name for the UI picker. */
  readonly label: string;
  /**
   * Send `prompt` and return the model's text.
   *
   * Throws an `AiError` subclass on any failure. Implementations never return
   * a partial or placeholder answer that could be mistaken for a real one —
   * degradation is the caller's decision, made explicit at the call site.
   */
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;
  /**
   * True when this provider is configured well enough to attempt a call
   * (key present, binary on PATH, …). Cheap and synchronous: it must not make
   * a network call, and a `true` here is not a promise that the call will
   * succeed.
   */
  available(): boolean;
  /** Why the provider is unavailable, for the UI to show. Empty when available. */
  unavailableReason(): string;
  /** The model this provider will use, for display and audit. */
  readonly model: string;
}

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
/**
 * 64 KiB of text is far more than any feature here asks for (the largest is a
 * few paragraphs of narration) and small enough that a runaway response cannot
 * exhaust a request handler.
 */
export const DEFAULT_MAX_OUTPUT_CHARS = 64 * 1024;

/** Base class for every provider failure. Callers degrade on `AiError`. */
export class AiError extends Error {
  readonly providerId: ProviderId;

  constructor(providerId: ProviderId, message: string) {
    super(message);
    this.name = new.target.name;
    this.providerId = providerId;
  }
}

/** No key, no binary, no base URL — the provider was never usable. */
export class AiNotConfiguredError extends AiError {}

/** The call exceeded its wall-clock budget and was aborted. */
export class AiTimeoutError extends AiError {
  readonly timeoutMs: number;

  constructor(providerId: ProviderId, timeoutMs: number) {
    super(providerId, `${providerId}: no response within ${timeoutMs}ms; call aborted`);
    this.timeoutMs = timeoutMs;
  }
}

/** Authentication was rejected (401/403). */
export class AiAuthError extends AiError {}

/** Rate limited or over quota (429). */
export class AiRateLimitError extends AiError {}

/** Any other transport or upstream failure. */
export class AiTransportError extends AiError {
  readonly status?: number;

  constructor(providerId: ProviderId, message: string, status?: number) {
    super(providerId, message);
    if (status !== undefined) this.status = status;
  }
}

/** The response was well-formed HTTP but not usable output. */
export class AiMalformedResponseError extends AiError {}

/** The response exceeded `maxOutputChars`. Refused rather than truncated. */
export class AiOutputTooLargeError extends AiError {
  readonly size: number;
  readonly limit: number;

  constructor(providerId: ProviderId, size: number, limit: number) {
    super(
      providerId,
      `${providerId}: response of ${size} characters exceeds the ${limit} character cap`,
    );
    this.size = size;
    this.limit = limit;
  }
}

/**
 * Map an HTTP status onto the right error class, so callers can distinguish
 * "your key is wrong" from "try again later" without string matching.
 */
export function errorForStatus(
  providerId: ProviderId,
  status: number,
  detail: string,
): AiError {
  if (status === 401 || status === 403) {
    return new AiAuthError(providerId, `${providerId}: authentication rejected (HTTP ${status})`);
  }
  if (status === 429) {
    return new AiRateLimitError(providerId, `${providerId}: rate limited (HTTP 429)`);
  }
  return new AiTransportError(providerId, `${providerId}: HTTP ${status} — ${detail}`, status);
}

/**
 * Enforce the output cap. Refusing an oversize body rather than truncating it
 * matters: a truncated JSON document is *invalid*, which fails closed, whereas
 * a truncated one that happens to still parse would be a silently wrong answer.
 */
export function enforceOutputCap(
  providerId: ProviderId,
  text: string,
  limit: number,
): string {
  if (text.length > limit) {
    throw new AiOutputTooLargeError(providerId, text.length, limit);
  }
  return text;
}

/**
 * Run `fn` under a combined timeout + caller-cancellation signal, translating
 * an abort into `AiTimeoutError`.
 */
export async function withTimeout<T>(
  providerId: ProviderId,
  timeoutMs: number,
  outerSignal: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener('abort', onOuterAbort, { once: true });
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (controller.signal.aborted && outerSignal?.aborted !== true) {
      throw new AiTimeoutError(providerId, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', onOuterAbort);
  }
}
