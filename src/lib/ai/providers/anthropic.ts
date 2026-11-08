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

const ID = 'anthropic' as const;
const DEFAULT_MODEL = 'claude-opus-5-5';
const ANTHROPIC_VERSION = '2023-06-01';
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

export interface AnthropicOptions {
  /** Overrides `ANTHROPIC_API_KEY`. Server-side only; never reaches the client. */
  readonly apiKey?: string;
  /** Model override. Defaults to `ANTHROPIC_MODEL` or `claude-opus-5-5`. */
  readonly model?: string;
  /** Injectable for tests. Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

interface AnthropicBlock {
  readonly type?: unknown;
  readonly text?: unknown;
}

function extractText(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new AiMalformedResponseError(ID, 'anthropic: response body was not an object');
  }
  const record = body as Record<string, unknown>;
  const content = record.content;
  if (!Array.isArray(content)) {
    throw new AiMalformedResponseError(ID, 'anthropic: response carried no content blocks');
  }

  const text = (content as readonly AnthropicBlock[])
    .map((block) =>
      block.type === 'text' && typeof block.text === 'string' ? block.text : '',
    )
    .join('');
  if (text.trim().length === 0) {
    throw new AiMalformedResponseError(ID, 'anthropic: response contained no text');
  }
  return text;
}

export function createAnthropicProvider(options: AnthropicOptions = {}): Provider {
  const apiKey = options.apiKey ?? readSecret('ANTHROPIC_API_KEY');
  const model = options.model ?? readSetting('ANTHROPIC_MODEL') ?? DEFAULT_MODEL;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    id: ID,
    label: `Anthropic (${model})`,
    model,

    available(): boolean {
      return apiKey !== undefined;
    },

    unavailableReason(): string {
      return apiKey === undefined ? 'ANTHROPIC_API_KEY is not set' : '';
    },

    async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
      if (apiKey === undefined) {
        throw new AiNotConfiguredError(ID, 'anthropic: ANTHROPIC_API_KEY is not set');
      }
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const maxChars = opts.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

      const payload: Record<string, unknown> = {
        model,
        max_tokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      };
      if (opts.system !== undefined) {
        payload.system = opts.system;
      }
      if (opts.temperature !== undefined) {
        payload.temperature = opts.temperature;
      }

      return withTimeout(ID, timeoutMs, opts.signal, async (signal) => {
        const response = await doFetch(MESSAGES_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
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
          throw new AiMalformedResponseError(ID, 'anthropic: response was not valid JSON');
        }
        return enforceOutputCap(ID, extractText(body), maxChars);
      });
    },
  };
}
