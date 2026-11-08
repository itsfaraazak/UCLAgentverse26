import { loadLibrary } from '@/components/protein/runtime/errors';

/**
 * The only path to the three.js cell engine — a clean code-split point, and
 * the single seam tests use to simulate a chunk-load failure.
 */
export function loadCellEngine(): Promise<typeof import('./engine')> {
  return loadLibrary(() => import('./engine'));
}
