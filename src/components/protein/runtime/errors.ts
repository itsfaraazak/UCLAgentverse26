/**
 * Error vocabulary shared by both 3D components. Deliberately three-free so
 * the React shells can classify failures without statically importing the
 * rendering engines (which would drag `three` into the initial bundle).
 *
 * Classification is by `name`, not `instanceof`, because the engine module is
 * loaded through a dynamic `import()` and the shells must not import it.
 */

export type FailureKind =
  /** The three.js / engine chunk failed to download or evaluate. */
  | 'library'
  /** The structure file could not be fetched (offline, HTTP error, timeout). */
  | 'network'
  /** The structure file arrived but could not be used. */
  | 'data'
  /** Neither WebGPU nor WebGL 2 could be initialised on this device. */
  | 'renderer'
  /** The GPU context was lost after rendering started. */
  | 'context-lost'
  | 'unknown';

export class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

export class RendererUnavailableError extends Error {
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) {
    super(`No usable GPU renderer: ${reasons.join('; ')}`);
    this.name = 'RendererUnavailableError';
    this.reasons = reasons;
  }
}

export class LibraryLoadError extends Error {
  constructor(cause: unknown) {
    super(`3D library failed to load (${describe(cause)})`);
    this.name = 'LibraryLoadError';
  }
}

export class PdbFetchError extends Error {
  readonly status: number | null;
  constructor(detail: string, status: number | null = null) {
    super(detail);
    this.name = 'PdbFetchError';
    this.status = status;
  }
}

export class StructureDataError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'StructureDataError';
  }
}

export class ContextLostError extends Error {
  constructor() {
    super('The GPU context was lost (driver reset, or too many 3D views open).');
    this.name = 'ContextLostError';
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function classifyFailure(err: unknown): FailureKind {
  if (!(err instanceof Error)) return 'unknown';
  switch (err.name) {
    case 'LibraryLoadError':
      return 'library';
    case 'PdbFetchError':
      return 'network';
    case 'StructureDataError':
      return 'data';
    case 'RendererUnavailableError':
      return 'renderer';
    case 'ContextLostError':
      return 'context-lost';
    default:
      return 'unknown';
  }
}

/** Wrap a dynamic import so a chunk failure is tagged as a library failure. */
export async function loadLibrary<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    throw new LibraryLoadError(err);
  }
}
