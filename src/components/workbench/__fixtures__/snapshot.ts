import { compareWithReference, interpret } from '@/lib/evidence/interpret';
import type { ClinvarRecord, LiteratureResult, SourceRef, VariantEvidence } from '@/lib/evidence/types';
import type { Actor, AnyDelta, DeltaDataMap, GateData, WbDelta, WbDeltaKind, WorkspaceSnapshot } from '@/lib/workbench/types';

/**
 * A workspace as the server would send it after three runs: rs334 reviewed
 * (VUS, MAJOR disagreement with ClinVar), a red-team prompt blocked and
 * redacted, and BRCA1 c.5266dupC signed off and merged into main.
 * Interpretations come from the real ACMG engine.
 */

export const ALICE = { name: 'Dr Alice Hart', role: 'Clinical scientist' } as const;
const alice: Actor = { kind: 'human', ...ALICE };
const gemini: Actor = { kind: 'agent', name: 'Workbench agent', model: 'gemini-4-argon' };
const gateActor: Actor = { kind: 'agent', name: 'Safety gate', model: null };
const engine: Actor = { kind: 'agent', name: 'ACMG engine', model: null };
const tools: Actor = { kind: 'agent', name: 'Evidence tools', model: null };

const T0 = Date.parse('2026-11-08T09:00:00.000Z');

/** 16-hex-char ids with a distinct 8-char prefix per delta. */
export const ID = {
  brcaPrompt: 'b1000000000000a1',
  brcaGate: 'b2000000000000a2',
  brcaEvidence: 'b3000000000000a3',
  brcaInterp: 'b4000000000000a4',
  brcaReference: 'b5000000000000a5',
  brcaSignoff: 'b6000000000000a6',
  merge: 'c1000000000000c1',
  prompt: 'd1000000000000d1',
  gate: 'd2000000000000d2',
  plan: 'd3000000000000d3',
  evidence: 'd4000000000000d4',
  interp: 'd5000000000000d5',
  reference: 'd6000000000000d6',
  literature: 'd7000000000000d7',
  message: 'd8000000000000d8',
  comment: 'd9000000000000d9',
  blockedPrompt: 'e1000000000000e1',
  blockedGate: 'e2000000000000e2',
} as const;

export const BRANCH = {
  rs334: 'review/rs334',
  blocked: 'blocked/7f3a9c21',
  brca: 'review/brca1-c-5266dupc',
} as const;

export const BLOCKED_DIGEST = '7f3a9c21d04b5e6f8a9b0c1d2e3f4a5b';
export const BLOCKED_ORIGINAL = 'Propose disrupting BRCA1';

const RETRIEVED = '2026-11-08T08:55:00.000Z';
const src = (name: string, url: string, cached = false): SourceRef => ({
  name,
  url,
  licence: 'CC BY 4.0',
  licenceUrl: null,
  retrievedAt: RETRIEVED,
  cached,
});
const MYVARIANT = src('MyVariant.info', 'https://myvariant.info/v1/variant/chr11:g.5227002T%3EA');
const GNOMAD = src('gnomAD (v2.1.1, via MyVariant.info)', 'https://myvariant.info/v1/variant/chr11:g.5227002T%3EA');
const CLINVAR_SRC = src('ClinVar (NCBI)', 'https://www.ncbi.nlm.nih.gov/clinvar/variation/15333/');
const EPMC = src('Europe PMC', 'https://europepmc.org/search?query=HBB', true);

export const HBB_EVIDENCE: VariantEvidence = {
  variant: {
    id: 'chr11:g.5227002T>A',
    assembly: 'GRCh38',
    rsid: 'rs334',
    gene: 'HBB',
    hgvsCoding: 'NM_000518.5:c.20A>T',
    hgvsProtein: 'NP_000509.1:p.Glu7Val',
    query: 'rs334',
    alternates: ['chr11:g.5227002T>C', 'chr11:g.5227002T>G'],
  },
  consequence: 'missense',
  consequenceRaw: ['missense_variant'],
  protein: { refAa: 'E', altAa: 'V', position: 7, refCodon: 'GAG', altCodon: 'GTG' },
  population: { gnomadGenomeAf: 0.0127, gnomadExomeAf: 0.0094, maxAf: 0.0127 },
  predictors: { alphaMissense: 0.2271, alphaMissenseClass: 'likely_benign', caddPhred: 22.4 },
  sources: [MYVARIANT, GNOMAD],
};

export const HBB_CLINVAR: ClinvarRecord = {
  found: true,
  consensus: 'Pathogenic',
  significances: ['Pathogenic', 'Pathogenic', 'other'],
  reviewStatus: 'criteria provided, multiple submitters, no conflicts',
  stars: 2,
  url: 'https://www.ncbi.nlm.nih.gov/clinvar/variation/15333/',
  source: CLINVAR_SRC,
};

const BRCA_EVIDENCE: VariantEvidence = {
  variant: {
    id: 'chr17:g.43057062_43057063dup',
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
  protein: { refAa: 'Q', altAa: null, position: 1756, refCodon: null, altCodon: null },
  population: { gnomadGenomeAf: null, gnomadExomeAf: 0.00002, maxAf: 0.00002 },
  predictors: { alphaMissense: null, alphaMissenseClass: null, caddPhred: 33 },
  sources: [MYVARIANT],
};

export const HBB_INTERPRETATION = interpret(HBB_EVIDENCE);
export const HBB_COMPARISON = compareWithReference(HBB_INTERPRETATION, HBB_CLINVAR);
const BRCA_INTERPRETATION = interpret(BRCA_EVIDENCE);
const BRCA_COMPARISON = compareWithReference(BRCA_INTERPRETATION, { ...HBB_CLINVAR, stars: 3, reviewStatus: 'reviewed by expert panel' });

export const PAPERS: LiteratureResult = {
  query: 'HBB AND ("p.Glu7Val" OR "c.20A>T" OR "rs334")',
  papers: [
    {
      pmid: '29542687',
      title: 'Sickle cell disease: a review of the HBB p.Glu7Val variant',
      journal: 'Nat Rev Dis Primers',
      year: 2018,
      url: 'https://europepmc.org/article/MED/29542687',
    },
    { pmid: null, title: 'Malaria selection and the sickle allele', journal: null, year: 2024, url: 'https://europepmc.org/article/PPR/PPR123' },
  ],
  source: EPMC,
};

export const MESSAGE_MARKDOWN = [
  `**Uncertain Significance** at -5 points [${ID.interp}].`,
  '',
  `- BS1: the allele is common in gnomAD (1.27%) [${ID.evidence.slice(0, 8)}]`,
  '- BP4: AlphaMissense 0.227 is in the *likely benign* zone',
  '',
  `ClinVar calls it Pathogenic, a MAJOR disagreement [${ID.reference}]. See [ClinVar](https://www.ncbi.nlm.nih.gov/clinvar/variation/15333/).`,
].join('\n');

let seq = 0;
function delta<K extends WbDeltaKind>(
  id: string,
  branch: string,
  kind: K,
  actor: Actor,
  title: string,
  data: DeltaDataMap[K],
  extra: { body?: string; parents?: readonly string[]; sources?: readonly SourceRef[] } = {},
): WbDelta<K> {
  seq += 1;
  return {
    id,
    seq,
    branch,
    kind,
    actor,
    title,
    body: extra.body ?? '',
    data,
    parents: extra.parents ?? [],
    at: new Date(T0 + seq * 60_000).toISOString(),
    sources: extra.sources ?? [],
  } as WbDelta<K>;
}

const allowGate: GateData = {
  mode: 'interpret',
  verdict: 'allow',
  category: 'VARIANT_INTERPRETATION',
  reason: 'Interpreting an observed variant proposes no edit.',
  requiresSignoff: false,
  signoffRole: null,
  flaggedGenes: ['HBB'],
  redacted: false,
  requestDigest: '0123456789abcdef0123456789abcdef',
};

export const BLOCK_GATE: GateData = {
  mode: 'edit',
  verdict: 'block',
  category: 'TUMOUR_SUPPRESSOR_DISRUPTION',
  reason: 'Disrupting a tumour suppressor is refused.',
  requiresSignoff: false,
  signoffRole: null,
  flaggedGenes: ['BRCA1'],
  redacted: true,
  requestDigest: BLOCKED_DIGEST,
};

export const PROMPT_TEXT = 'Assess rs334 in a patient with recurrent pain crises';
export const COMMENT_TEXT = 'The patient has malaria-endemic ancestry, so **BS1** may be overstated.';

const deltas: AnyDelta[] = [
  delta(ID.brcaPrompt, BRANCH.brca, 'prompt', alice, 'Interpret BRCA1 c.5266dupC', { text: 'Interpret BRCA1 c.5266dupC' }),
  delta(ID.brcaGate, BRANCH.brca, 'gate', gateActor, 'Gate: allow (VARIANT_INTERPRETATION)', { ...allowGate, flaggedGenes: ['BRCA1'] }, { parents: [ID.brcaPrompt] }),
  delta(ID.brcaEvidence, BRANCH.brca, 'evidence', tools, 'Evidence for BRCA1 c.5266dup', { evidence: BRCA_EVIDENCE, tool: null }, { parents: [ID.brcaGate], sources: [MYVARIANT] }),
  delta(ID.brcaInterp, BRANCH.brca, 'interpretation', engine, 'ACMG: Pathogenic (+10)', { interpretation: BRCA_INTERPRETATION, evidenceDelta: ID.brcaEvidence }, { parents: [ID.brcaEvidence] }),
  delta(ID.brcaReference, BRANCH.brca, 'reference', engine, 'Agrees with ClinVar', { comparison: BRCA_COMPARISON, interpretationDelta: ID.brcaInterp }, { parents: [ID.brcaInterp] }),
  delta(
    ID.brcaSignoff,
    BRANCH.brca,
    'signoff',
    alice,
    'Signed off: Pathogenic',
    { finalClassification: 'Pathogenic', agentClassification: 'Pathogenic', agreesWithAgent: true, rationale: '', covers: ID.brcaInterp },
    { parents: [ID.brcaReference] },
  ),
  delta(ID.merge, 'main', 'merge', alice, `Merged ${BRANCH.brca}`, { branch: BRANCH.brca, branchHead: ID.brcaSignoff }, { parents: [ID.brcaSignoff] }),

  delta(ID.prompt, BRANCH.rs334, 'prompt', alice, PROMPT_TEXT, { text: PROMPT_TEXT }),
  delta(ID.gate, BRANCH.rs334, 'gate', gateActor, 'Gate: allow (VARIANT_INTERPRETATION)', allowGate, { body: allowGate.reason, parents: [ID.prompt] }),
  delta(ID.plan, BRANCH.rs334, 'plan', gemini, 'Plan', { steps: ['Resolve rs334', 'Fetch population and predictor evidence', 'Classify with ACMG', 'Compare with ClinVar'] }, { parents: [ID.gate] }),
  delta(
    ID.evidence,
    BRANCH.rs334,
    'evidence',
    tools,
    'Evidence for HBB p.Glu7Val',
    { evidence: HBB_EVIDENCE, tool: { name: 'fetch_evidence', args: { query: 'rs334' }, ms: 412 } },
    { parents: [ID.plan], sources: HBB_EVIDENCE.sources },
  ),
  delta(ID.interp, BRANCH.rs334, 'interpretation', engine, 'ACMG: Uncertain Significance (-5)', { interpretation: HBB_INTERPRETATION, evidenceDelta: ID.evidence }, { parents: [ID.evidence] }),
  delta(
    ID.reference,
    BRANCH.rs334,
    'reference',
    engine,
    'MAJOR disagreement with ClinVar',
    { comparison: HBB_COMPARISON, interpretationDelta: ID.interp },
    { parents: [ID.interp], sources: [CLINVAR_SRC] },
  ),
  delta(ID.literature, BRANCH.rs334, 'literature', tools, '2 papers', { result: PAPERS, tool: { name: 'search_literature', args: {}, ms: 900 } }, { parents: [ID.evidence], sources: [EPMC] }),
  delta(ID.message, BRANCH.rs334, 'message', gemini, 'Summary', { markdown: MESSAGE_MARKDOWN }, { body: 'Summary', parents: [ID.reference, ID.literature] }),
  delta(ID.comment, BRANCH.rs334, 'comment', alice, 'Ancestry context', { text: COMMENT_TEXT, onDelta: ID.interp }, { parents: [ID.interp] }),

  delta(ID.blockedPrompt, BRANCH.blocked, 'prompt', alice, 'Request withheld by policy', {
    text: `[withheld by policy - request digest ${BLOCKED_DIGEST}]`,
  }),
  delta(ID.blockedGate, BRANCH.blocked, 'gate', gateActor, 'Gate: block (TUMOUR_SUPPRESSOR_DISRUPTION)', BLOCK_GATE, {
    body: BLOCK_GATE.reason,
    parents: [ID.blockedPrompt],
  }),
];

const created = (i: number) => new Date(T0 + i * 1000).toISOString();

export const SNAPSHOT: WorkspaceSnapshot = {
  id: 'ws-test',
  title: 'Workbench',
  branches: [
    { name: 'main', title: 'Case record', parent: null, createdBy: alice, createdAt: created(0), status: 'open', head: ID.merge },
    {
      name: BRANCH.brca,
      title: 'Interpret BRCA1 c.5266dupC',
      parent: { branch: 'main', delta: null },
      createdBy: alice,
      createdAt: created(1),
      status: 'merged',
      head: ID.brcaSignoff,
    },
    {
      name: BRANCH.rs334,
      title: PROMPT_TEXT,
      parent: { branch: 'main', delta: null },
      createdBy: alice,
      createdAt: created(2),
      status: 'open',
      head: ID.comment,
    },
    {
      name: BRANCH.blocked,
      title: `Withheld request ${BLOCKED_DIGEST}`,
      parent: { branch: 'main', delta: null },
      createdBy: alice,
      createdAt: created(3),
      status: 'blocked',
      head: ID.blockedGate,
    },
  ],
  deltas,
  merge: {
    [BRANCH.rs334]: {
      allowed: false,
      requiredRole: null,
      checks: [
        { id: 'gate', label: 'Safety gate allowed the request', state: 'pass', detail: 'Interpretation only.' },
        { id: 'classification', label: 'ACMG classification exists', state: 'pass', detail: 'Uncertain Significance (-5).' },
        { id: 'reference', label: 'Reference check reviewed', state: 'fail', detail: 'MAJOR disagreement with ClinVar needs a signed rationale.' },
        { id: 'signoff', label: 'Named human sign-off', state: 'pending', detail: 'No sign-off yet.' },
        { id: 'idle', label: 'No agent running', state: 'pass', detail: '' },
      ],
    },
    [BRANCH.blocked]: {
      allowed: false,
      requiredRole: null,
      checks: [{ id: 'gate', label: 'Safety gate allowed the request', state: 'fail', detail: 'Blocked by policy.' }],
    },
  },
  ai: { available: true, model: 'gemini-4-argon', reason: '' },
};

export function deltaById(id: string): AnyDelta {
  const d = SNAPSHOT.deltas.find((x) => x.id === id);
  if (!d) throw new Error(`no fixture delta ${id}`);
  return d;
}
