import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // `lib/` is framework-free and must stay testable in a plain node env.
    // Component tests opt into jsdom with a `// @vitest-environment jsdom`
    // pragma at the top of the file.
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/visual/**/*.test.ts'],
    globals: true,
    // Raised from the 5s default because several tests do real work rather
    // than mocking it: `graph/actions`, `bench/redteam` and `demo/scenario`
    // each run the genuine agent pipeline — sha256 content hashing plus the
    // headless cell simulation — multiple times per test. Those are the tests
    // that prove the gate is not theatre, so the cost is the point and
    // stubbing it out would gut them.
    //
    // At 5s they sit close enough to the ceiling that a loaded machine turns
    // them red with `Test timed out`, with no assertion failing. A timeout
    // that depends on competing load is a broken signal: it reads as a gate
    // bypass and invites someone to "fix" a security test that was passing.
    // Every assertion is unchanged; only the ceiling moved.
    testTimeout: 30_000,
    // Capped for the same reason. These tests are CPU-bound on real hashing
    // and simulation, so one worker per core is oversubscription as soon as
    // anything else runs on the machine: at full parallelism the suite failed
    // 2-12 tests with a *different* set each run, purely on `Test timed out`,
    // while the same files passed in isolation. At 50% it is 774/774 green on
    // the identical machine under identical load. A suite whose result
    // depends on what else is running is not a gate, and the failures land on
    // the sign-off and merge-gating tests — the ones nobody should be given a
    // reason to doubt.
    maxWorkers: '50%',
  },
});
