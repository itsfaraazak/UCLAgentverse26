import './server-only';

/**
 * Strict parsing of model output.
 *
 * Model output is untrusted data. It is never `eval`'d, never used to choose a
 * code path directly, and never trusted to be the shape it was asked for. The
 * only way a model's answer influences this app is by passing a validator here
 * and then being checked against a deterministic registry by the caller.
 *
 * Every function in this module fails closed: on anything unexpected it throws,
 * and the caller degrades to the non-AI path.
 */

/** The model's answer did not match the requested schema. */
export class AiSchemaError extends Error {
  constructor(message: string) {
    super(`model output rejected: ${message}`);
    this.name = new.target.name;
  }
}

/**
 * Pull a single JSON object out of a model response.
 *
 * Models wrap JSON in prose or fences however they like, so a fenced block is
 * unwrapped and a leading/trailing narration is tolerated — but only by
 * locating the outermost braces, never by repairing the JSON itself. Anything
 * that is not then valid JSON is rejected.
 */
export function extractJsonObject(raw: string): Record<string, unknown> {
  let text = raw.trim();

  // Unwrap ```json … ``` or ``` … ``` fences.
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(text);
  if (fence !== null && fence[1] !== undefined) {
    text = fence[1].trim();
  }

  if (!text.startsWith('{')) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new AiSchemaError('no JSON object found in the response');
    }
    text = text.slice(start, end + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiSchemaError('response was not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AiSchemaError('response JSON was not an object');
  }
  return parsed as Record<string, unknown>;
}

/** Require a string field. */
export function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string') {
    throw new AiSchemaError(`field '${key}' must be a string`);
  }
  return value;
}

export function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new AiSchemaError(`field '${key}' must be a string when present`);
  }
  return value;
}

/**
 * Require one of a fixed set of literals.
 *
 * This is how an enum-valued model answer is handled: the model picks from a
 * closed list that the code already knows, and an answer outside the list is
 * rejected rather than passed through. A model can therefore never widen the
 * set of outcomes the code can reach.
 */
export function requireEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = obj[key];
  if (typeof value !== 'string') {
    throw new AiSchemaError(`field '${key}' must be a string`);
  }
  const match = allowed.find((a) => a === value);
  if (match === undefined) {
    throw new AiSchemaError(
      `field '${key}' was ${JSON.stringify(value)}, which is not one of ${allowed.join(', ')}`,
    );
  }
  return match;
}

/** Require a boolean field. */
export function requireBoolean(obj: Record<string, unknown>, key: string): boolean {
  const value = obj[key];
  if (typeof value !== 'boolean') {
    throw new AiSchemaError(`field '${key}' must be a boolean`);
  }
  return value;
}

/** Require an array of strings, with a length cap so output size stays bounded. */
export function requireStringArray(
  obj: Record<string, unknown>,
  key: string,
  maxLength: number,
): string[] {
  const value = obj[key];
  if (!Array.isArray(value)) {
    throw new AiSchemaError(`field '${key}' must be an array`);
  }
  if (value.length > maxLength) {
    throw new AiSchemaError(`field '${key}' had ${value.length} entries, limit is ${maxLength}`);
  }
  return value.map((entry, i) => {
    if (typeof entry !== 'string') {
      throw new AiSchemaError(`field '${key}[${i}]' must be a string`);
    }
    return entry;
  });
}

/**
 * Clamp free prose from a model to a maximum length.
 *
 * Narration is the one place model text is rendered to the user, so its size
 * is bounded here rather than trusted.
 */
export function clampProse(text: string, maxChars: number): string {
  const collapsed = text.trim();
  return collapsed.length <= maxChars ? collapsed : `${collapsed.slice(0, maxChars).trimEnd()}…`;
}
