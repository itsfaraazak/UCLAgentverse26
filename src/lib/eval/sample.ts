/** Seeded sampling, so `pnpm eval:build` picks the same variants from the same candidate pool. */

/** mulberry32: small, fast, deterministic PRNG returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates on a copy. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Takes up to `target` items in order, skipping any whose gene already has
 * `cap` picks. `geneCounts` is shared across calls so the cap is global.
 */
export function takeWithGeneCap<T>(
  items: readonly T[],
  geneOf: (item: T) => string,
  target: number,
  cap: number,
  geneCounts: Map<string, number>,
): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (out.length >= target) break;
    const g = geneOf(item);
    const n = geneCounts.get(g) ?? 0;
    if (n >= cap) continue;
    geneCounts.set(g, n + 1);
    out.push(item);
  }
  return out;
}
