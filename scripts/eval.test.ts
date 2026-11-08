/**
 * Scores `src/data/eval/benchmark.json` offline and writes
 * `src/data/eval/results.json` and `docs/EVALUATION.md`. Run with `pnpm eval`;
 * rebuild the dataset with `pnpm eval:build`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';

import { evaluate, type Benchmark } from '@/lib/eval/benchmark';
import { evaluationMarkdown } from '@/lib/eval/report';

const root = process.cwd();

it('scores the benchmark and writes results.json + docs/EVALUATION.md', async () => {
  const benchmark = JSON.parse(await readFile(path.join(root, 'src', 'data', 'eval', 'benchmark.json'), 'utf8')) as Benchmark;
  const results = evaluate(benchmark);
  expect(evaluate(benchmark)).toEqual(results);

  await writeFile(path.join(root, 'src', 'data', 'eval', 'results.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  await writeFile(path.join(root, 'docs', 'EVALUATION.md'), evaluationMarkdown(results), 'utf8');

  for (const m of results.methods) {
    const o = m.overall;
    console.log(
      `${m.name}: coverage ${String(o.coverage.k)}/${String(o.coverage.n)}, accuracy ${String(o.accuracy.k)}/${String(o.accuracy.n)}, ` +
        `FR ${String(o.falseReassurance.k)}, FA ${String(o.falseAlarm.k)}`,
    );
  }
});
