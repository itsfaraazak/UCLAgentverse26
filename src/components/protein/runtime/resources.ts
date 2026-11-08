/**
 * GPU resource bookkeeping. Every geometry, material and texture an engine
 * creates goes through `track()`; `disposeAll()` frees them in one place.
 *
 * Three.js does not garbage-collect GPU memory: a BufferGeometry or Material
 * that is dropped without `.dispose()` keeps its buffers/programs alive for
 * the lifetime of the context. Tracking at creation time (rather than
 * traversing the scene on teardown) also catches resources that were never
 * added to the scene, or were swapped out of it — e.g. the previous
 * structure's meshes after a 2HBS ↔ 4HHB toggle.
 */
export interface Disposable {
  dispose(): void;
}

export class ResourceTracker {
  private readonly live = new Set<Disposable>();

  track<T extends Disposable>(resource: T): T {
    this.live.add(resource);
    return resource;
  }

  /** Dispose a subset early (e.g. on a structure swap) and stop tracking it. */
  release(resources: Iterable<Disposable>): void {
    for (const r of resources) {
      if (!this.live.delete(r)) continue;
      safeDispose(r);
    }
  }

  disposeAll(): void {
    for (const r of this.live) safeDispose(r);
    this.live.clear();
  }

  get size(): number {
    return this.live.size;
  }
}

function safeDispose(r: Disposable): void {
  try {
    r.dispose();
  } catch {
    // Already-lost contexts can throw on dispose; nothing more to free.
  }
}
