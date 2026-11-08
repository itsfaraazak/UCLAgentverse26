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

/**
 * How many characters of an oid the UI shows (SPEC §4.2).
 *
 * All three surfaces display abbreviated oids, and each had reimplemented
 * this. One definition here means an oid is abbreviated the same way
 * everywhere, and the width is stated once.
 */
export const SHORT_OID_LENGTH = 12;

/**
 * Abbreviate an oid for display. Never use the result to look an object up —
 * `Repo.read` takes a full oid, and this prefix is not checked for
 * uniqueness, unlike Git's abbreviated hashes.
 */
export function shortOid(oid: string, length: number = SHORT_OID_LENGTH): string {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`shortOid: length must be a positive integer, got ${length}`);
  }
  return oid.slice(0, length);
}
