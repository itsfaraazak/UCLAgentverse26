import '../server-only';
import { readSecret, readSetting } from '../server-only';
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

const ID = 'openai-compatible' as const;
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export interface OpenAiCompatibleOptions {
  /** Overrides `OPENAI_API_KEY`. Server-side only; never reaches the client. */
  readonly apiKey?: string;
  /** Model override. Defaults to `OPENAI_MODEL` or `gpt-4o-mini`. */
  readonly model?: string;
  /** Overrides `OPENAI_BASE_URL`. Trailing slashes are stripped. */
  readonly baseUrl?: string;
  /** Injectable for tests. Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function extractText(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new AiMalformedResponseError(ID, 'openai-compatible: response body was not an object');
  }
  const record = body as Record<string, unknown>;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new AiMalformedResponseError(ID, 'openai-compatible: response carried no choices');
  }

  const first = choices[0];
  if (typeof first !== 'object' || first === null) {
    throw new AiMalformedResponseError(ID, 'openai-compatible: choice was not an object');
  }
  const message = (first as Record<string, unknown>).message;
  if (typeof message !== 'object' || message === null) {
    throw new AiMalformedResponseError(ID, 'openai-compatible: choice carried no message');
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new AiMalformedResponseError(ID, 'openai-compatible: response contained no text');
  }
  return content;
}

export function createOpenAiCompatibleProvider(
  options: OpenAiCompatibleOptions = {},
): Provider {
  const apiKey = options.apiKey ?? readSecret('OPENAI_API_KEY');
  const model = options.model ?? readSetting('OPENAI_MODEL') ?? DEFAULT_MODEL;
  const baseUrlRaw = options.baseUrl ?? readSetting('OPENAI_BASE_URL') ?? DEFAULT_BASE_URL;
  const baseUrl = stripTrailingSlash(baseUrlRaw);
  const doFetch = options.fetchImpl ?? fetch;

  return {
    id: ID,
    label: `OpenAI-compatible (${model})`,
    model,

    available(): boolean {
      return apiKey !== undefined && baseUrl.length > 0;
    },

    unavailableReason(): string {
      if (apiKey === undefined) return 'OPENAI_API_KEY is not set';
      if (baseUrl.length === 0) return 'OPENAI_BASE_URL is not set';
      return '';
    },

    async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
      if (apiKey === undefined) {
        throw new AiNotConfiguredError(ID, 'openai-compatible: OPENAI_API_KEY is not set');
      }
      if (baseUrl.length === 0) {
        throw new AiNotConfiguredError(ID, 'openai-compatible: OPENAI_BASE_URL is not set');
      }
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxChars = opts.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

      const messages: Array<{ role: string; content: string }> = [];
      if (opts.system !== undefined) {
        messages.push({ role: 'system', content: opts.system });
      }
      messages.push({ role: 'user', content: prompt });

      const payload: Record<string, unknown> = {
        model,
        messages,
        max_tokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      };
      if (opts.temperature !== undefined) {
        payload.temperature = opts.temperature;
      }

      return withTimeout(ID, timeoutMs, opts.signal, async (signal) => {
        const response = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
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
          throw new AiMalformedResponseError(ID, 'openai-compatible: response was not valid JSON');
        }
        return enforceOutputCap(ID, extractText(body), maxChars);
      });
    },
  };
}
