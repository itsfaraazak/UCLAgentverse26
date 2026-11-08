import { ACMG_CITATION, ACMG_SCOPE_LIMITATION, bandForPoints, scoreAcmg } from '../acmg/score';
import { isActionable } from '../acmg/conflict';
import type { AcmgClassification, AcmgCode, AcmgInputs } from '../acmg/types';
import {
  NO_ASSERTIONS,
  type ClinvarRecord,
  type Consequence,
  type HumanAssertions,
  type Interpretation,
  type ReferenceComparison,
  type VariantEvidence,
} from './types';

/**
 * Genes where loss of function is an established disease mechanism, used to
 * approximate PVS1. Curated by hand for the demo; not exhaustive.
 */
export const LOF_MECHANISM_GENES: ReadonlySet<string> = new Set([
  'APC', 'ATM', 'BRCA1', 'BRCA2', 'CDH1', 'CFTR', 'DMD', 'HBB', 'LDLR', 'MLH1', 'MSH2', 'MSH6', 'MYBPC3',
  'NF1', 'PALB2', 'PMS2', 'PTEN', 'RB1', 'SCN1A', 'SMAD4', 'STK11', 'TP53', 'TSC1', 'TSC2', 'VHL',
]);

const NULL_CONSEQUENCES: ReadonlySet<Consequence> = new Set(['stop_gained', 'frameshift', 'splice', 'start_lost']);

/** Inside BP4/PP3's dead zone (0.3 <= s < 0.7): neither criterion can fire. */
export const NEUTRAL_IN_SILICO_SCORE = 0.5;

const CONSEQUENCE_WORDS: Readonly<Record<Consequence, string>> = {
  missense: 'a missense change (one amino acid swapped for another)',
  synonymous: 'a synonymous change (the protein sequence is unchanged)',
  stop_gained: 'a stop-gain (the protein is cut short)',
  frameshift: 'a frameshift (the reading frame is shifted, scrambling the rest of the protein)',
  splice: 'a canonical splice-site change (likely disrupts how the gene is spliced)',
  inframe_indel: 'an in-frame insertion or deletion (amino acids added or removed, frame kept)',
  start_lost: 'a start-loss (the protein\'s start signal is destroyed)',
  other: 'a non-coding or other change',
  unknown: 'of unknown effect (no annotator described it)',
};

function formatAf(af: number): string {
  if (af === 0) return '0';
  const pct = af * 100;
  const oneIn = Math.round(1 / af);
  return `${af.toPrecision(3)} (${pct < 0.01 ? pct.toExponential(1) : pct.toFixed(2)}%, about 1 in ${oneIn.toLocaleString('en-GB')})`;
}

function frequencyNote(e: VariantEvidence): string {
  const { maxAf, gnomadGenomeAf, gnomadExomeAf } = e.population;
  if (maxAf === null) {
    return (
      'Not seen in gnomAD (neither genomes nor exomes), so frequency is taken as 0. ' +
      'Absence from ~140,000 people counts as evidence the variant is rare.'
    );
  }
  const parts = [
    gnomadGenomeAf !== null ? `genomes ${formatAf(gnomadGenomeAf)}` : null,
    gnomadExomeAf !== null ? `exomes ${formatAf(gnomadExomeAf)}` : null,
  ].filter(Boolean);
  return `Highest gnomAD allele frequency: ${formatAf(maxAf)} [${parts.join('; ')}]. Higher frequency argues against a severe rare-disease variant.`;
}

function inSilico(e: VariantEvidence): { score: number; note: string } {
  const am = e.predictors.alphaMissense;
  if (e.consequence === 'missense' && am !== null) {
    const cls = e.predictors.alphaMissenseClass?.replace('_', ' ') ?? 'unclassified';
    return {
      score: am,
      note:
        `AlphaMissense score ${am.toFixed(3)} (${cls}; highest across transcripts). ` +
        'This is a structure-aware AI prediction of whether the amino-acid swap damages the protein: ' +
        '>= 0.7 supports pathogenic (PP3), < 0.3 supports benign (BP4).',
    };
  }
  const why =
    e.consequence !== 'missense'
      ? `AlphaMissense only scores missense variants and this one is ${CONSEQUENCE_WORDS[e.consequence]}`
      : 'no AlphaMissense score is available for this missense variant';
  return {
    score: NEUTRAL_IN_SILICO_SCORE,
    note: `Computational criteria (PP3/BP4) not applied: ${why}. A neutral 0.5 is used so neither fires.`,
  };
}

function nullVariant(e: VariantEvidence): { met: boolean; note: string } {
  const gene = e.variant.gene;
  const isNull = NULL_CONSEQUENCES.has(e.consequence);
  const lofGene = gene !== null && LOF_MECHANISM_GENES.has(gene.toUpperCase());
  const approx =
    ' (Approximation of PVS1: checks consequence type and a curated gene list only; no check for nonsense-mediated decay, last-exon position or alternative transcripts.)';
  if (isNull && lofGene) {
    return { met: true, note: `The variant is ${CONSEQUENCE_WORDS[e.consequence]} in ${gene}, a gene where losing one working copy is a known cause of disease.${approx}` };
  }
  if (isNull) {
    return { met: false, note: `The variant is ${CONSEQUENCE_WORDS[e.consequence]}, but ${gene ?? 'the gene'} is not on our list of genes where loss of function is an established disease mechanism.${approx}` };
  }
  return { met: false, note: `Not a null variant: it is ${CONSEQUENCE_WORDS[e.consequence]}.${approx}` };
}

export function interpret(evidence: VariantEvidence, assertions: HumanAssertions = NO_ASSERTIONS): Interpretation {
  const silico = inSilico(evidence);
  const lof = nullVariant(evidence);
  const segregation = assertions.segregation;

  const inputs: AcmgInputs = {
    populationFrequency: evidence.population.maxAf ?? 0,
    isNullVariantInLofGene: lof.met,
    matchesKnownPathogenicAaChange: false,
    inSilicoDeleteriousScore: silico.score,
    segregatesWithDisease: segregation?.value ?? false,
  };
  const inputNotes: Record<keyof AcmgInputs, string> = {
    populationFrequency: frequencyNote(evidence),
    isNullVariantInLofGene: lof.note,
    matchesKnownPathogenicAaChange:
      'PS1 not assessed: it asks whether this exact amino-acid change is already known to be pathogenic, ' +
      'which needs ClinVar, and ClinVar is held out as the answer key.',
    inSilicoDeleteriousScore: silico.note,
    segregatesWithDisease: segregation
      ? `${segregation.by} recorded that the variant ${segregation.value ? 'does' : 'does not'} track with disease in the family: "${segregation.reason}".`
      : 'No family data recorded. Whether the variant tracks with disease in relatives can only come from a human, so PP1 is off.',
  };

  const engine = scoreAcmg(inputs);
  const dismissed = assertions.dismissed;
  const seen = new Set<AcmgCode>();
  let points = engine.points;
  for (const d of dismissed) {
    if (seen.has(d.code)) throw new RangeError(`Criterion ${d.code} was dismissed more than once.`);
    seen.add(d.code);
    const criterion = engine.criteria.find((c) => c.code === d.code);
    if (!criterion?.met) {
      throw new RangeError(`Cannot dismiss ${d.code}: the rule engine did not apply it to this variant, so there is nothing to remove.`);
    }
    points -= criterion.weight;
  }
  const ba1Active = engine.criteria.some((c) => c.code === 'BA1' && c.met) && !seen.has('BA1');
  const classification: AcmgClassification =
    dismissed.length === 0 ? engine.classification : ba1Active ? 'Benign' : bandForPoints(points);

  return {
    inputs,
    inputNotes,
    engine,
    points,
    classification,
    dismissed,
    limitation: ACMG_SCOPE_LIMITATION,
    citation: ACMG_CITATION,
  };
}

const SIDE_WORDS = 'the actionable line (Pathogenic / Likely Pathogenic versus everything else)';

export function compareWithReference(interpretation: Interpretation, clinvar: ClinvarRecord): ReferenceComparison {
  const agent = interpretation.classification;
  const base = { clinvar, agentClassification: agent };
  const consensus = clinvar.consensus;
  if (!clinvar.found || consensus === null) {
    return { ...base, agrees: null, severity: 'unavailable', note: 'ClinVar has no record of this variant, so there is no reference call to compare against.' };
  }
  if (consensus === 'Conflicting') {
    return { ...base, agrees: null, severity: 'unavailable', note: 'ClinVar submitters disagree with each other about this variant, so there is no single reference call to compare against.' };
  }
  if (consensus === 'Other') {
    return { ...base, agrees: null, severity: 'unavailable', note: 'ClinVar lists this variant only with non-pathogenicity labels (e.g. drug response or risk factor), so there is no reference call to compare against.' };
  }

  const stars = `${String(clinvar.stars)}-star review status`;
  if (consensus === agent) {
    return { ...base, agrees: true, severity: 'none', note: `Agrees with ClinVar: both call it ${agent} (ClinVar ${stars}).` };
  }
  const major = isActionable(consensus) !== isActionable(agent);
  return {
    ...base,
    agrees: false,
    severity: major ? 'major' : 'minor',
    note: major
      ? `Major disagreement: the agents call it ${agent} but ClinVar says ${consensus} (${stars}). The two calls fall on opposite sides of ${SIDE_WORDS}, which could change what a clinician does. A human should review which evidence the rule engine is missing.`
      : `Minor disagreement: the agents call it ${agent} and ClinVar says ${consensus} (${stars}). Both sit on the same side of ${SIDE_WORDS}, so the clinical action would not change.`,
  };
}
