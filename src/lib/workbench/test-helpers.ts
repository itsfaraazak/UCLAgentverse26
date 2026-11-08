import { compareWithReference, interpret } from '../evidence/interpret';
import {
  VariantNotFoundError,
  type ClinvarRecord,
  type EvidenceBundle,
  type EvidenceService,
  type LiteratureResult,
  type ResolvedVariant,
  type SourceRef,
  type VariantEvidence,
} from '../evidence/types';
import type { StreamEvent } from './api-types';
import type { GeminiClient } from './gemini';
import { WorkbenchService } from './service';
import { WorkbenchStore } from './store';
import type { AiStatus } from './types';

/** Test doubles for the workbench: canned evidence, real classifier, no network. */

const source = (name: string): SourceRef => ({
  name,
  url: `https://example.org/${name}`,
  licence: 'test',
  licenceUrl: null,
  retrievedAt: '2026-11-08T00:00:00.000Z',
  cached: true,
});

function clinvar(consensus: ClinvarRecord['consensus'], stars: ClinvarRecord['stars']): ClinvarRecord {
  return {
    found: consensus !== null,
    consensus,
    significances: consensus ? [consensus] : [],
    reviewStatus: 'reviewed by expert panel',
    stars,
    url: null,
    source: source('ClinVar'),
  };
}

const HBB: VariantEvidence = {
  variant: {
    id: 'chr11:g.5227002T>A',
    assembly: 'GRCh38',
    rsid: 'rs334',
    gene: 'HBB',
    hgvsCoding: 'NM_000518.5:c.20A>T',
    hgvsProtein: 'NP_000509.1:p.Glu7Val',
    query: 'rs334',
    alternates: [],
  },
  consequence: 'missense',
  consequenceRaw: ['missense_variant'],
  protein: { refAa: 'Glu', altAa: 'Val', position: 7, refCodon: 'GAG', altCodon: 'GTG' },
  population: { gnomadGenomeAf: 0.0065, gnomadExomeAf: 0.004, maxAf: 0.0065 },
  predictors: { alphaMissense: 0.2, alphaMissenseClass: 'likely_benign', caddPhred: 20 },
  sources: [source('MyVariant.info')],
};

const BRCA1: VariantEvidence = {
  variant: {
    id: 'chr17:g.43057062dup',
    assembly: 'GRCh38',
    rsid: 'rs80357906',
    gene: 'BRCA1',
    hgvsCoding: 'NM_007294.4:c.5266dup',
    hgvsProtein: 'NP_009225.1:p.Gln1756fs',
    query: 'BRCA1 c.5266dupC',
    alternates: [],
  },
  consequence: 'frameshift',
  consequenceRaw: ['frameshift_variant'],
  protein: { refAa: 'Gln', altAa: null, position: 1756, refCodon: null, altCodon: null },
  population: { gnomadGenomeAf: 0.0001, gnomadExomeAf: 0.0002, maxAf: 0.0002 },
  predictors: { alphaMissense: null, alphaMissenseClass: null, caddPhred: 35 },
  sources: [source('MyVariant.info')],
};

export const FIXTURES: Record<string, EvidenceBundle> = {
  rs334: { evidence: HBB, clinvar: clinvar('Pathogenic', 3) },
  rs80357906: { evidence: BRCA1, clinvar: clinvar('Pathogenic', 3) },
};

function keyFor(query: string): string | null {
  const q = query.toLowerCase();
  if (q.includes('rs334') || q.includes('glu7val') || q.includes('hbb')) return 'rs334';
  if (q.includes('5266') || q.includes('rs80357906') || q.includes('brca1')) return 'rs80357906';
  return null;
}

export interface FakeEvidence extends EvidenceService {
  readonly calls: { resolve: string[]; literature: string[] };
  maxInFlight: number;
}

/** Network methods are canned (with a small delay); classification is the real engine. */
export function fakeEvidence(delayMs = 5): FakeEvidence {
  let inFlight = 0;
  const track = async <T>(fn: () => T): Promise<T> => {
    inFlight++;
    fake.maxInFlight = Math.max(fake.maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, delayMs));
      return fn();
    } finally {
      inFlight--;
    }
  };
  const fake: FakeEvidence = {
    calls: { resolve: [], literature: [] },
    maxInFlight: 0,
    resolveVariant(query: string): Promise<ResolvedVariant> {
      fake.calls.resolve.push(query);
      return track(() => {
        const key = keyFor(query);
        if (key === null) throw new VariantNotFoundError(query);
        return { ...FIXTURES[key].evidence.variant, query };
      });
    },
    fetchEvidence(variant: ResolvedVariant): Promise<EvidenceBundle> {
      return track(() => FIXTURES[variant.rsid ?? '']);
    },
    interpret,
    compareWithReference,
    searchLiterature(query: string): Promise<LiteratureResult> {
      fake.calls.literature.push(query);
      return track(() => ({
        query,
        papers: [{ pmid: '123', title: `Paper about ${query}`, journal: 'J Test', year: 2020, url: 'https://europepmc.org/abstract/MED/123' }],
        source: source('Europe PMC'),
      }));
    },
  };
  return fake;
}

export const NO_AI: AiStatus = { available: false, model: 'gemini-4-argon', reason: 'test' };

export function testService(opts: { evidence?: EvidenceService; gemini?: GeminiClient; store?: WorkbenchStore } = {}) {
  const store = opts.store ?? new WorkbenchStore({ file: null });
  const evidence = opts.evidence ?? fakeEvidence();
  return new WorkbenchService({
    store,
    evidence: () => evidence,
    gemini: () => opts.gemini ?? null,
    ai: () => NO_AI,
  });
}

export async function collect(run: (emit: (e: StreamEvent) => void) => Promise<void>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  await run((e) => events.push(e));
  return events;
}

export const ALICE = { name: 'Dr Alice Hart', role: 'Clinical scientist' } as const;
export const IBC = { name: 'Prof Ben Ode', role: 'Institutional biosafety committee' } as const;
