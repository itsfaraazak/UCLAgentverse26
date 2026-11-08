/**
 * Defensive readers for MyVariant.info documents. Any field may be a scalar,
 * an array (one entry per transcript or submission), nested arrays, or absent.
 */

export type Json = Readonly<Record<string, unknown>>;

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? (value as unknown[]).flat(Infinity) : [value];
}

/** Dotted-path lookup that fans out over arrays at every level and flattens the result. */
export function pick(doc: unknown, dottedPath: string): unknown[] {
  let current: unknown[] = asArray(doc);
  for (const key of dottedPath.split('.')) {
    current = current.flatMap((node) => (isObject(node) ? asArray(node[key]) : []));
  }
  return current;
}

export function strings(values: readonly unknown[]): string[] {
  return values
    .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
    .map((v) => String(v).trim())
    .filter((v) => v !== '' && v !== '.');
}

export function numbers(values: readonly unknown[]): number[] {
  return values
    .map((v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN))
    .filter((v) => Number.isFinite(v));
}

export function firstString(doc: unknown, ...paths: string[]): string | null {
  for (const p of paths) {
    const found = strings(pick(doc, p));
    if (found.length > 0) return found[0];
  }
  return null;
}

export function maxNumber(doc: unknown, dottedPath: string): number | null {
  const found = numbers(pick(doc, dottedPath));
  return found.length > 0 ? Math.max(...found) : null;
}

export function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}
