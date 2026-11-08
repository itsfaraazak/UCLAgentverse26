import { loadLibrary } from './runtime/errors';

/**
 * The only path to the three.js engine. Keeping the dynamic `import()` in
 * its own module gives the bundler a clean split point (three never lands in
 * the server bundle or the host page's initial chunk) and gives tests one
 * seam to simulate a chunk-load failure.
 */
export function loadProteinEngine(): Promise<typeof import('./engine')> {
  return loadLibrary(() => import('./engine'));
}
