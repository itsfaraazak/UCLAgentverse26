/**
 * Records live MyVariant.info and Europe PMC responses for the demo variants
 * into `src/data/evidence-cache/`, the committed fallback the evidence service
 * reads when the network is down. Run with `pnpm snapshot:evidence`.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createEvidenceService, literatureQueryFor } from '@/lib/evidence';

const DEMO_QUERIES = [
  'rs334',
  'BRCA1 c.5266dupC',
  'CFTR p.Phe508del',
  'HBB c.20A>T',
  'TP53 p.Arg175His',
  'rs1042522',
  'rs1801133',
] as const;

const service = createEvidenceService({
  cacheDir: null,
  snapshotDir: path.join(process.cwd(), 'src', 'data', 'evidence-cache'),
  recordSnapshots: true,
  myVariantTimeoutMs: 60_000,
  europePmcTimeoutMs: 120_000,
});

describe('snapshot evidence for demo variants', () => {
  for (const query of DEMO_QUERIES) {
    it(query, async () => {
      const variant = await service.resolveVariant(query);
      const bundle = await service.fetchEvidence(variant);
      expect(bundle.evidence.sources.every((s) => !s.cached)).toBe(true);
      const interpretation = service.interpret(bundle.evidence);
      const comparison = service.compareWithReference(interpretation, bundle.clinvar);
      const literature = await service.searchLiterature(literatureQueryFor(bundle.evidence));
      expect(literature.source.cached).toBe(false);
      console.log(
        [
          `${query} -> ${variant.id} (${variant.gene ?? '?'} ${variant.hgvsProtein ?? variant.hgvsCoding ?? ''}, ${variant.rsid ?? 'no rsid'})`,
          `  ${bundle.evidence.consequence}, maxAf=${String(bundle.evidence.population.maxAf)}, AM=${String(bundle.evidence.predictors.alphaMissense)}`,
          `  agents: ${interpretation.classification} (${String(interpretation.points)} pts: ${interpretation.engine.criteria.filter((c) => c.met).map((c) => c.code).join(', ') || 'none'})`,
          `  ClinVar: ${String(bundle.clinvar.consensus)} (${String(bundle.clinvar.stars)}*) -> ${comparison.severity}`,
          `  literature "${literature.query}": ${String(literature.papers.length)} papers`,
        ].join('\n'),
      );
    });
  }
});
