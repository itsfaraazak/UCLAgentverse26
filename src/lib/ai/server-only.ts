/**
 * Server-only guard for `src/lib/ai`.
 *
 * SPEC.md §8 keeps `lib/` framework-free. This module is the single declared
 * exception: it holds the BYOK provider harness, which reads API keys from the
 * environment and must never be bundled into a browser chunk.
 *
 * Rather than depend on React's `server-only` package (a framework import this
 * directory is otherwise free of), the boundary is enforced directly: importing
 * anything under `lib/ai` from a browser bundle throws at module-evaluation
 * time. That is a loud build/runtime failure rather than a key leak.
 *
 * Every module under `lib/ai` imports this first.
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/ai is server-only: it reads provider API keys from the environment and ' +
      'must not be imported into a browser bundle. Call it from a Server Action ' +
      'or a route handler and pass only the result to the client.',
  );
}

/**
 * Read a secret from the environment.
 *
 * Deliberately refuses `NEXT_PUBLIC_*` names: those are inlined into the
 * client bundle by Next.js, so a key held in one is already public. Failing
 * here turns a silent key disclosure into a startup error.
 */
export function readSecret(name: string): string | undefined {
  if (name.startsWith('NEXT_PUBLIC_')) {
    throw new Error(
      `refusing to read secret from ${name}: NEXT_PUBLIC_* variables are inlined ` +
        `into the client bundle and cannot hold a key`,
    );
  }
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Read a non-secret setting. */
export function readSetting(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
