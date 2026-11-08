/**
 * Rebuilds `src/data/eval/benchmark.json` from live MyVariant.info: a seeded,
 * gene-capped, balanced sample of >= 2-star ClinVar P/LP and B/LB variants,
 * stored with the exact field list the evidence service requests. Run with
 * `pnpm eval:build`; `pnpm eval` then scores it offline.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';

import { MYVARIANT_BASE, MYVARIANT_FIELDS, hitsOf, toClinvarRecord, toEvidence, toResolvedVariant } from '@/lib/evidence/myvariant';
import { asArray, firstString, isObject, type Json } from '@/lib/evidence/normalise';
import { ALPHAMISSENSE, CADD, CLINVAR, DBSNP, GNOMAD, MYVARIANT, SNPEFF } from '@/lib/evidence/sources';
import type { Benchmark, BenchmarkStratum, BenchmarkVariant } from '@/lib/eval/benchmark';
import { consequenceGroup } from '@/lib/eval/methods';
import type { Truth } from '@/lib/eval/metrics';
import { seededRandom, shuffle, takeWithGeneCap } from '@/lib/eval/sample';

const SEED = 20261108;
const GENE_CAP = 5;
const PER_TRUTH = 100;
const BENIGN_LOF_MAX = 30;
const PAGES = 6;
const PAGE_SIZE = 100;
/** Elasticsearch window: from + size must stay <= 10,000. */
const MAX_WINDOW = 10_000;
const DELAY_MS = 800;

const REVIEW = 'clinvar.rcv.review_status:("reviewed by expert panel" OR "criteria provided, multiple submitters, no conflicts")';
const SIG: Record<Truth, string> = {
  'P/LP': 'clinvar.rcv.clinical_significance:("Pathogenic" OR "Likely pathogenic" OR "Pathogenic/Likely pathogenic")',
  'B/LB': 'clinvar.rcv.clinical_significance:("Benign" OR "Likely benign" OR "Benign/Likely benign")',
};
const EFFECT = {
  missense: 'snpeff.ann.effect:missense_variant',
  lof: 'snpeff.ann.effect:(stop_gained OR frameshift_variant OR splice_acceptor_variant OR splice_donor_variant)',
} as const;
const CANDIDATE_FIELDS = [
  'clinvar.rcv.clinical_significance',
  'clinvar.rcv.review_status',
  'clinvar.variant_id',
  'clinvar.gene.symbol',
  'snpeff.ann.effect',
  'snpeff.ann.genename',
  'cadd.consequence',
];

interface StratumSpec {
  readonly id: string;
  readonly truth: Truth;
  readonly group: 'missense' | 'lof';
}

/** Scarce strata first so the global gene cap does not starve them. */
const STRATA: readonly StratumSpec[] = [
  { id: 'benign-lof', truth: 'B/LB', group: 'lof' },
  { id: 'pathogenic-lof', truth: 'P/LP', group: 'lof' },
  { id: 'pathogenic-missense', truth: 'P/LP', group: 'missense' },
  { id: 'benign-missense', truth: 'B/LB', group: 'missense' },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  await sleep(DELAY_MS);
  const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...init?.headers }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${String(res.status)} for ${url}: ${await res.text()}`);
  return res.json();
}

function queryUrl(q: string, size: number, from: number, fields: readonly string[]): string {
  const p = new URLSearchParams({ assembly: 'hg38', q, size: String(size), from: String(from) });
  if (fields.length > 0) p.set('fields', fields.join(','));
  return `${MYVARIANT_BASE}/query?${p.toString()}`;
}

function stripMeta(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMeta);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !['_license', '_score', '_version', 'query'].includes(k))
      .map(([k, v]) => [k, stripMeta(v)]),
  );
}

const FETCHED = { retrievedAt: new Date().toISOString(), cached: false };

function labelOf(hit: Json, spec: StratumSpec): BenchmarkVariant['clinvar'] | null {
  const rec = toClinvarRecord(hit, null, FETCHED);
  const c = rec.consensus;
  if (rec.stars < 2 || c === null || c === 'Conflicting' || c === 'Other' || c === 'Uncertain Significance') return null;
  const truth: Truth = c === 'Pathogenic' || c === 'Likely Pathogenic' ? 'P/LP' : 'B/LB';
  if (truth !== spec.truth) return null;
  return { consensus: c, stars: rec.stars, reviewStatus: rec.reviewStatus, url: rec.url };
}

function groupOf(hit: Json): string {
  const id = String(hit._id);
  return consequenceGroup(toEvidence(hit, toResolvedVariant(hit, id, []), FETCHED).consequence);
}

function geneOf(hit: Json): string | null {
  return firstString(hit, 'clinvar.gene.symbol', 'snpeff.ann.genename');
}

it('builds src/data/eval/benchmark.json from live MyVariant.info', async () => {
  const random = seededRandom(SEED);
  const geneCounts = new Map<string, number>();
  const seen = new Set<string>();
  const strata: BenchmarkStratum[] = [];
  const picked: { spec: StratumSpec; id: string; gene: string }[] = [];

  for (const spec of STRATA) {
    const q = `${REVIEW} AND ${SIG[spec.truth]} AND ${EFFECT[spec.group]}`;
    const total = Number((await getJson(queryUrl(q, 0, 0, [])) as { total: number }).total);
    const window = Math.min(total, MAX_WINDOW);
    const pages =
      window <= PAGE_SIZE * PAGES
        ? [{ from: 0, size: Math.min(window, 1000) }]
        : [...new Set(Array.from({ length: PAGES }, () => Math.floor(random() * (window - PAGE_SIZE))))]
            .sort((a, b) => a - b)
            .map((from) => ({ from, size: PAGE_SIZE }));

    const pool: { id: string; gene: string }[] = [];
    for (const page of pages) {
      for (const hit of hitsOf(await getJson(queryUrl(q, page.size, page.from, CANDIDATE_FIELDS)))) {
        const id = String(hit._id);
        const gene = geneOf(hit);
        if (seen.has(id) || gene === null || labelOf(hit, spec) === null || groupOf(hit) !== spec.group) continue;
        seen.add(id);
        pool.push({ id, gene });
      }
    }
    const already = picked.filter((p) => p.spec.truth === spec.truth).length;
    const target = spec.id === 'benign-lof' ? BENIGN_LOF_MAX : spec.id === 'pathogenic-lof' ? PER_TRUTH / 2 : PER_TRUTH - already;
    const chosen = takeWithGeneCap(shuffle(pool, random), (p) => p.gene, target, GENE_CAP, geneCounts);
    picked.push(...chosen.map((c) => ({ spec, ...c })));
    strata.push({ id: spec.id, truth: spec.truth, group: spec.group, query: q, total, pages, eligible: pool.length, target, selected: chosen.length });
    console.log(`${spec.id}: total=${String(total)} eligible=${String(pool.length)} selected=${String(chosen.length)}/${String(target)}`);
  }

  const body = new URLSearchParams({ ids: picked.map((p) => p.id).join(','), fields: MYVARIANT_FIELDS.join(','), assembly: 'hg38' });
  const docs = asArray(
    await getJson(`${MYVARIANT_BASE}/variant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }),
  ).filter(isObject);
  const byId = new Map(docs.filter((d) => d.notfound !== true).map((d) => [String(d._id), stripMeta(d) as Json]));

  const variants: BenchmarkVariant[] = [];
  for (const p of picked) {
    const hit = byId.get(p.id);
    const label = hit ? labelOf(hit, p.spec) : null;
    if (!hit || !label || groupOf(hit) !== p.spec.group) {
      console.warn(`dropped ${p.id}: full document no longer matches its stratum`);
      continue;
    }
    variants.push({ id: p.id, stratum: p.spec.id, gene: p.gene, truth: p.spec.truth, clinvar: label, hit });
  }

  const benchmark: Benchmark = {
    schemaVersion: 1,
    title: 'SigmaFold ClinVar expert-consensus benchmark',
    dataNote:
      'Real, public, de-identified variant annotations from ClinVar, gnomAD, dbNSFP (AlphaMissense), CADD and snpEff via MyVariant.info. ' +
      'No patient data: these are population-level reference records, not individual genomes.',
    provenance: {
      api: MYVARIANT_BASE,
      assembly: 'hg38',
      fetchedAt: FETCHED.retrievedAt,
      seed: SEED,
      geneCap: GENE_CAP,
      inclusion:
        'ClinVar review status of at least 2 stars (reviewed by expert panel, or criteria provided, multiple submitters, no conflicts) ' +
        'and a consensus of Pathogenic/Likely Pathogenic or Benign/Likely Benign under the evidence layer\'s own ClinVar parser ' +
        '(conflicting and VUS records excluded). Consequence (missense vs stop/frameshift/canonical splice) from the evidence layer\'s normaliser. ' +
        `Candidates come from ${String(PAGES)} seeded random pages of ${String(PAGE_SIZE)} per stratum (all hits when fewer), shuffled with the seed, ` +
        `then taken in order with at most ${String(GENE_CAP)} variants per gene across the whole set.`,
      candidateFields: CANDIDATE_FIELDS,
      documentRequest: `POST ${MYVARIANT_BASE}/variant with ids=<the variant ids below>, assembly=hg38, fields=<fields>`,
      fields: MYVARIANT_FIELDS,
      strata,
      licences: [CLINVAR, GNOMAD, ALPHAMISSENSE, CADD, SNPEFF, DBSNP, MYVARIANT].map(({ name, licence, licenceUrl }) => ({ name, licence, licenceUrl })),
    },
    variants,
  };

  const out = path.join(process.cwd(), 'src', 'data', 'eval', 'benchmark.json');
  await mkdir(path.dirname(out), { recursive: true });
  const rows = variants.map((v) => `    ${JSON.stringify(v)}`).join(',\n');
  const text = JSON.stringify({ ...benchmark, variants: [] }, null, 2).replace('"variants": []', `"variants": [\n${rows}\n  ]`);
  await writeFile(out, `${text}\n`, 'utf8');
  console.log(`wrote ${String(variants.length)} variants across ${String(geneCounts.size)} genes to ${out}`);
  expect(variants.length).toBeGreaterThan(150);
});
