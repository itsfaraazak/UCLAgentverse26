import { createHash } from 'node:crypto';

/**
 * Recursively sort object keys and emit JSON with no incidental whitespace.
 * Arrays keep their order. `undefined` object fields are omitted.
 */
export function canonicalJson(value: unknown): string {
  return encode(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encode(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('canonicalJson: non-finite numbers cannot be hashed');
      }
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map(encode).join(',')}]`;
      }
      if (!isPlainObject(value)) {
        throw new Error('canonicalJson: cannot encode this object');
      }
      const keys = Object.keys(value).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const field = value[key];
        if (field === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${encode(field)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new Error(`canonicalJson: cannot encode ${typeof value}`);
  }
}

export function oidOfCanonical(json: string): string {
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/** Full hex SHA-256 of the canonical JSON encoding. */
export function oidOf(value: unknown): string {
  return oidOfCanonical(canonicalJson(value));
}
