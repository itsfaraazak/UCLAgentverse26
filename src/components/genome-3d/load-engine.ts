import { loadLibrary } from '@/components/protein/runtime/errors';

/**
 * The only path to the three.js genome engine. Keeping the dynamic `import()`
 * in its own module gives the bundler a clean split point — `three` never
 * lands in a host page's initial chunk or the server bundle — and gives tests
 * one seam to simulate a chunk-load failure.
 */
export function loadGenomeEngine(): Promise<typeof import('./engine')> {
  return loadLibrary(() => import('./engine'));
}
