import '../ai/server-only';
import { readSecret, readSetting } from '../ai/server-only';
import { GEMINI_MODEL, assertNotFlash, geminiGenerateContentUrl } from '../ai/models';
import {
  AiError,
  AiMalformedResponseError,
  AiNotConfiguredError,
  AiOutputTooLargeError,
  AiTransportError,
  errorForStatus,
  withTimeout,
} from '../ai/types';
import type { AiStatus } from './types';

const ID = 'gemini' as const;

/** Argon takes ~15-45s per call; anything past this is treated as an outage. */
export const GEMINI_TIMEOUT_MS = 90_000;
const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;

export interface GeminiFunctionCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly id?: string;
}

/**
 * A content part. Model parts are kept verbatim (including `thoughtSignature`
 * and any unknown fields) because the API requires them echoed back.
 */
export interface GeminiPart {
  readonly text?: string;
  readonly thought?: boolean;
  readonly thoughtSignature?: string;
  readonly functionCall?: GeminiFunctionCall;
  readonly functionResponse?: { readonly name: string; readonly id?: string; readonly response: Record<string, unknown> };
  readonly [key: string]: unknown;
}

export interface GeminiContent {
  readonly role: 'user' | 'model';
  readonly parts: readonly GeminiPart[];
}

export interface FunctionDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface GenerateRequest {
  readonly system: string;
  readonly contents: readonly GeminiContent[];
  readonly tools: readonly FunctionDeclaration[];
  /** Disable function calling so the model must answer in text. */
  readonly forceText?: boolean;
}

export interface GenerateResult {
  /** The model turn exactly as returned; append it to history unchanged. */
  readonly content: GeminiContent;
  /** Visible text (thought summaries excluded). */
  readonly text: string;
  readonly calls: readonly GeminiFunctionCall[];
  readonly ms: number;
}

export interface GeminiClient {
  readonly model: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export interface GeminiClientOptions {
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export function forceFallback(): boolean {
  return readSetting('WORKBENCH_FORCE_FALLBACK') === '1';
}

export function aiStatus(): AiStatus {
  if (forceFallback()) {
    return { available: false, model: GEMINI_MODEL, reason: 'Language model disabled (WORKBENCH_FORCE_FALLBACK=1); deterministic pipeline only.' };
  }
  if (readSecret('GEMINI_API_KEY') === undefined) {
    return { available: false, model: GEMINI_MODEL, reason: 'GEMINI_API_KEY is not set; deterministic pipeline only.' };
  }
  return { available: true, model: GEMINI_MODEL, reason: '' };
}

/** The configured client, or null when the model is unavailable or disabled. */
export function defaultGeminiClient(): GeminiClient | null {
  if (!aiStatus().available) return null;
  return createGeminiClient();
}

function parseResult(body: unknown, ms: number): GenerateResult {
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const candidates = record.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    const feedback = record.promptFeedback as Record<string, unknown> | undefined;
    const reason = typeof feedback?.blockReason === 'string' ? ` (blockReason: ${feedback.blockReason})` : '';
    throw new AiMalformedResponseError(ID, `gemini: no candidates returned${reason}`);
  }
  const first = candidates[0] as Record<string, unknown>;
  const content = first?.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    const finish = typeof first?.finishReason === 'string' ? ` (finishReason: ${first.finishReason})` : '';
    throw new AiMalformedResponseError(ID, `gemini: candidate carried no parts${finish}`);
  }
  const typed = parts as GeminiPart[];
  const calls: GeminiFunctionCall[] = [];
  for (const p of typed) {
    const fc = p.functionCall as Record<string, unknown> | undefined;
    if (fc && typeof fc.name === 'string') {
      const args = typeof fc.args === 'object' && fc.args !== null ? (fc.args as Record<string, unknown>) : {};
      calls.push({ name: fc.name, args, ...(typeof fc.id === 'string' ? { id: fc.id } : {}) });
    }
  }
  const text = typed
    .filter((p) => typeof p.text === 'string' && p.thought !== true)
    .map((p) => p.text as string)
    .join('')
    .trim();
  return { content: { role: 'model', parts: typed }, text, calls, ms };
}

export function createGeminiClient(options: GeminiClientOptions = {}): GeminiClient {
  const apiKey = options.apiKey ?? readSecret('GEMINI_API_KEY');
  const model = assertNotFlash(GEMINI_MODEL);
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? GEMINI_TIMEOUT_MS;

  return {
    model,
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      if (apiKey === undefined) throw new AiNotConfiguredError(ID, 'gemini: GEMINI_API_KEY is not set');
      const payload: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: req.contents,
        tools: [{ functionDeclarations: req.tools }],
        // Thinking tokens count against this budget, so it is generous.
        generationConfig: { maxOutputTokens: 8192 },
      };
      if (req.forceText) payload.toolConfig = { functionCallingConfig: { mode: 'NONE' } };

      const started = Date.now();
      try {
        return await withTimeout(ID, timeoutMs, undefined, async (signal) => {
          const response = await doFetch(geminiGenerateContentUrl(model, apiKey), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal,
          });
          if (!response.ok) {
            // The error body can echo request content, so only the status is surfaced.
            throw errorForStatus(ID, response.status, response.statusText);
          }
          const raw = await response.text();
          if (raw.length > MAX_RESPONSE_CHARS) throw new AiOutputTooLargeError(ID, raw.length, MAX_RESPONSE_CHARS);
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {
            throw new AiMalformedResponseError(ID, 'gemini: response was not valid JSON');
          }
          return parseResult(body, Date.now() - started);
        });
      } catch (err) {
        if (err instanceof AiError) throw err;
        // Network errors can carry the request URL, which holds the key.
        throw new AiTransportError(ID, 'gemini: network error reaching the API');
      }
    },
  };
}

/** A plain, key-free sentence for an error delta. */
export function describeAiError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'AiNotConfiguredError':
      return `${GEMINI_MODEL} is not configured (no API key).`;
    case 'AiTimeoutError':
      return `${GEMINI_MODEL} did not answer within ${GEMINI_TIMEOUT_MS / 1000}s.`;
    case 'AiAuthError':
      return `${GEMINI_MODEL} rejected the API key.`;
    case 'AiRateLimitError':
      return `${GEMINI_MODEL} is rate limited right now.`;
    case 'AiMalformedResponseError':
    case 'AiOutputTooLargeError':
      return `${GEMINI_MODEL} returned an unusable response.`;
    case 'AiTransportError': {
      const status = (err as AiTransportError).status;
      return `${GEMINI_MODEL} is unreachable${status ? ` (HTTP ${status})` : ''}.`;
    }
    default:
      return `${GEMINI_MODEL} returned no usable answer.`;
  }
}
