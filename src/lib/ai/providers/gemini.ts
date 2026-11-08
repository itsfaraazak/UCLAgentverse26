import '../server-only';
import { readSecret } from '../server-only';
import {
  GEMINI_MODEL,
  assertNotFlash,
  geminiGenerateContentUrl,
  geminiListModelsUrl,
} from '../models';
import {
  AiMalformedResponseError,
  AiNotConfiguredError,
  DEFAULT_MAX_OUTPUT_CHARS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_TIMEOUT_MS,
  enforceOutputCap,
  errorForStatus,
  withTimeout,
  type CompleteOptions,
  type Provider,
} from '../types';

const ID = 'gemini' as const;

/**
 * Google Generative Language (Gemini) provider, pinned to `gemini-4-argon`.
 *
 * Auth detail that costs an hour if you get it wrong: **the API key goes in
 * the `?key=` query parameter.** Sending it as an `Authorization: Bearer`
 * header returns 401 against this API.
 */
export interface GeminiOptions {
  /** Overrides `GEMINI_API_KEY`. Server-side only; never reaches the client. */
  readonly apiKey?: string;
  /**
   * Model override. Still passes through `assertNotFlash`, so this cannot be
   * used to downgrade to a Flash variant.
   */
  readonly model?: string;
  /** Injectable for tests. Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

interface GeminiPart {
  readonly text?: unknown;
}

function extractText(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new AiMalformedResponseError(ID, 'gemini: response body was not an object');
  }
  const record = body as Record<string, unknown>;

  // A prompt rejected by the backend's own filters comes back with no
  // candidates. Surface it as malformed rather than as an empty answer, so a
  // caller degrades visibly instead of rendering a blank result.
  const candidates = record.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    const feedback = record.promptFeedback;
    const blockReason =
      typeof feedback === 'object' && feedback !== null
        ? (feedback as Record<string, unknown>).blockReason
        : undefined;
    throw new AiMalformedResponseError(
      ID,
      typeof blockReason === 'string'
        ? `gemini: no candidates returned (blockReason: ${blockReason})`
        : 'gemini: no candidates returned',
    );
  }

  const first = candidates[0];
  if (typeof first !== 'object' || first === null) {
    throw new AiMalformedResponseError(ID, 'gemini: candidate was not an object');
  }
  const content = (first as Record<string, unknown>).content;
  const parts =
    typeof content === 'object' && content !== null
      ? (content as Record<string, unknown>).parts
      : undefined;
  if (!Array.isArray(parts)) {
    const finish = (first as Record<string, unknown>).finishReason;
    throw new AiMalformedResponseError(
      ID,
      `gemini: candidate carried no parts${typeof finish === 'string' ? ` (finishReason: ${finish})` : ''}`,
    );
  }

  const text = (parts as readonly GeminiPart[])
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('');
  if (text.trim().length === 0) {
    throw new AiMalformedResponseError(ID, 'gemini: response contained no text');
  }
  return text;
}

export function createGeminiProvider(options: GeminiOptions = {}): Provider {
  const apiKey = options.apiKey ?? readSecret('GEMINI_API_KEY');
  // Runs at construction so a stray Flash override fails at startup.
  const model = assertNotFlash(options.model ?? GEMINI_MODEL);
  const doFetch = options.fetchImpl ?? fetch;

  return {
    id: ID,
    label: `Gemini (${model})`,
    model,

    available(): boolean {
      return apiKey !== undefined;
    },

    unavailableReason(): string {
      return apiKey === undefined ? 'GEMINI_API_KEY is not set' : '';
    },

    async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
      if (apiKey === undefined) {
        throw new AiNotConfiguredError(ID, 'gemini: GEMINI_API_KEY is not set');
      }
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxChars = opts.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

      const payload: Record<string, unknown> = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
        },
      };
      if (opts.system !== undefined) {
        payload.systemInstruction = { parts: [{ text: opts.system }] };
      }

      return withTimeout(ID, timeoutMs, opts.signal, async (signal) => {
        const response = await doFetch(geminiGenerateContentUrl(model, apiKey), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal,
        });

        if (!response.ok) {
          // The error body can echo request content, so it is not propagated.
          throw errorForStatus(ID, response.status, response.statusText);
        }

        const raw = await response.text();
        // Cap before parsing: a multi-megabyte body should never reach JSON.parse.
        enforceOutputCap(ID, raw, maxChars);

        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          throw new AiMalformedResponseError(ID, 'gemini: response was not valid JSON');
        }
        return enforceOutputCap(ID, extractText(body), maxChars);
      });
    },
  };
}

/**
 * Ask the API which models the key can see.
 *
 * Used by the diagnostic script rather than at request time — the brief's
 * instruction to discover models instead of trusting a hardcoded name is
 * honoured by *verifying* Argon is present, not by picking a substitute if it
 * is absent. If Argon is missing, that is a surfaced error.
 */
export async function listGeminiModels(options: GeminiOptions = {}): Promise<string[]> {
  const apiKey = options.apiKey ?? readSecret('GEMINI_API_KEY');
  if (apiKey === undefined) {
    throw new AiNotConfiguredError(ID, 'gemini: GEMINI_API_KEY is not set');
  }
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(geminiListModelsUrl(apiKey), { method: 'GET' });
  if (!response.ok) {
    throw errorForStatus(ID, response.status, response.statusText);
  }
  const body: unknown = await response.json();
  const models =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).models
      : undefined;
  if (!Array.isArray(models)) {
    throw new AiMalformedResponseError(ID, 'gemini: model list was not an array');
  }
  return models
    .map((m) =>
      typeof m === 'object' && m !== null && typeof (m as Record<string, unknown>).name === 'string'
        ? ((m as Record<string, unknown>).name as string).replace(/^models\//, '')
        : '',
    )
    .filter((n) => n.length > 0);
}
