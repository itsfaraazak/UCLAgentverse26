/**
 * Deterministic ACMG/AMP 2015 variant classification, using the point values
 * from Tavtigian et al. 2018's Bayesian point-based refinement of the ACMG/AMP
 * guidelines (Genet Med 20:1054-1060). Ported from the `score_acmg` function
 * on the `feature/deltagene-prototype` branch (`deltagene/agents/acmg_agent.py`).
 *
 * Rule-based and LLM-free on purpose: this is a layer a reviewer can re-derive
 * by hand from the trail it returns.
 *
 * Criteria implemented — a deliberately small, demo-scoped subset of the full
 * ~28-criterion ACMG/AMP framework:
 *
 *   PVS1  null variant in a gene where LoF is a known disease mechanism   +8
 *   PS1*  matches an established pathogenic amino-acid change             +4
 *   PM2   absent/rare in population databases (freq < 0.0005)             +2
 *   PP3   computational evidence supports a deleterious effect (>= 0.7)   +1
 *   PP1*  co-segregates with disease in affected relatives                +1
 *   BA1   stand-alone benign: population frequency > 0.05      -> forces Benign
 *   BS1*  frequency higher than expected for the disorder (0.01-0.05]     -4
 *   BP4   computational evidence suggests a benign effect (< 0.3)          -1
 *
 * (*) LIMITATION, carried over verbatim in substance from the source: PS1, BS1
 * and PP1 are normally about specific orthogonal evidence lines. Here each is
 * approximated from the single available input field. The labels are kept
 * close to, but are not a strict rename of, the official codes. This is a
 * scoped demonstration of a real rule engine, not a certified clinical tool.
 * Do not remove this caveat, and surface `ACMG_SCOPE_LIMITATION` wherever a
 * classification is shown.
 *
 * Bands (Tavtigian et al. 2018, points -> category):
 *   >= 10      Pathogenic
 *   6 .. 9     Likely Pathogenic
 *   -5 .. 5    Uncertain Significance
 *   -9 .. -6   Likely Benign
 *   <= -10     Benign
 * BA1 overrides every band.
 */

import type { AcmgClassification, AcmgCode, AcmgCriterion, AcmgInputs, AcmgResult } from './types';

export const ACMG_SCOPE_LIMITATION =
  'Scoped demonstration of a real rule engine, not a certified clinical tool. ' +
  'Implements 8 of the ~28 ACMG/AMP 2015 criteria using Tavtigian et al. 2018 ' +
  'point values (Genet Med 20:1054-1060). PS1, BS1 and PP1 are approximated ' +
  'from a single input field each rather than the orthogonal evidence lines ' +
  'the official codes require. Because the scoped subset omits the ' +
  'case-control and functional-study criteria, it is deliberately ' +
  'conservative: it can land one band below a full curation (the HBB rs334 ' +
  'example scores Likely Pathogenic where ClinVar reports Pathogenic). ' +
  'The only negative weights in this subset are -4 and -1, so the lowest ' +
  'reachable total is -5: Likely Benign is unreachable by points, and Benign ' +
  'is reached only by the BA1 stand-alone rule. Not a substitute for a ' +
  'clinical geneticist.';

export const ACMG_CITATION =
  'Richards et al. 2015, Genet Med 17:405-424 (ACMG/AMP criteria); ' +
  'Tavtigian et al. 2018, Genet Med 20:1054-1060 (point-based refinement).';

const PVS1_POINTS = 8;
const PS1_POINTS = 4;
const PM2_POINTS = 2;
const PP3_POINTS = 1;
const PP1_POINTS = 1;
const BS1_POINTS = -4;
const BP4_POINTS = -1;

const PM2_MAX_FREQ = 0.0005;
const BS1_MIN_FREQ = 0.01;
const BA1_MIN_FREQ = 0.05;
const PP3_MIN_SCORE = 0.7;
const BP4_MAX_SCORE = 0.3;

/**
 * Points -> band. Points are always an integer sum of integer weights, so the
 * five ranges below partition every reachable value with no gaps. Written as
 * explicit inclusive bounds (rather than a descending `>=` ladder) so each line
 * reads the same as the published table.
 */
export function bandForPoints(points: number): AcmgClassification {
  if (!Number.isInteger(points)) {
    throw new RangeError(`bandForPoints: points must be an integer, got ${String(points)}`);
  }
  if (points >= 10) return 'Pathogenic';
  if (points >= 6 && points <= 9) return 'Likely Pathogenic';
  if (points >= -5 && points <= 5) return 'Uncertain Significance';
  if (points >= -9 && points <= -6) return 'Likely Benign';
  return 'Benign';
}

function requireUnitInterval(name: string, value: number): void {
  // Departure from the source, which trusted its fixtures: a NaN frequency
  // there silently fails every comparison and drops PM2/BS1/BA1 all at once.
  // Fail closed instead (SPEC §4.6 #13's "reject with a clear error").
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`scoreAcmg: ${name} must be a finite number in [0, 1], got ${String(value)}`);
  }
}

export function scoreAcmg(inputs: AcmgInputs): AcmgResult {
  const freq = inputs.populationFrequency;
  const score = inputs.inSilicoDeleteriousScore;
  requireUnitInterval('populationFrequency', freq);
  requireUnitInterval('inSilicoDeleteriousScore', score);

  const criteria: AcmgCriterion[] = [];
  let points = 0;

  const mark = (code: AcmgCode, met: boolean, weight: number, note: string): void => {
    if (met) points += weight;
    criteria.push({ code, met, weight: met ? weight : 0, note });
  };

  mark(
    'PVS1',
    inputs.isNullVariantInLofGene,
    PVS1_POINTS,
    'Null variant in a gene where loss-of-function is a known disease mechanism.',
  );
  mark(
    'PS1',
    inputs.matchesKnownPathogenicAaChange,
    PS1_POINTS,
    'Matches an established pathogenic amino-acid change.',
  );
  mark(
    'PM2',
    freq < PM2_MAX_FREQ,
    PM2_POINTS,
    `Absent/rare in population databases (freq=${String(freq)} < ${String(PM2_MAX_FREQ)}).`,
  );
  mark(
    'PP3',
    score >= PP3_MIN_SCORE,
    PP3_POINTS,
    `Computational evidence supports a deleterious effect (score >= ${String(PP3_MIN_SCORE)}).`,
  );
  mark(
    'PP1',
    inputs.segregatesWithDisease,
    PP1_POINTS,
    'Co-segregates with disease in affected relatives.',
  );

  // BA1 contributes no points: it is a stand-alone rule, applied below as an
  // override. Recording it with weight 0 keeps the trail honest about why the
  // band and the point total can disagree.
  const ba1 = freq > BA1_MIN_FREQ;
  criteria.push({
    code: 'BA1',
    met: ba1,
    weight: 0,
    note:
      `Stand-alone benign: freq=${String(freq)} > ${String(BA1_MIN_FREQ)} ` +
      (ba1 ? '(OVERRIDES all other evidence -> Benign).' : '(not met).'),
  });

  // Upper bound inclusive, lower exclusive, exactly as the source. The two
  // frequency bands are disjoint: BS1 tops out at 0.05 and BA1 starts above it.
  mark(
    'BS1',
    freq > BS1_MIN_FREQ && freq <= BA1_MIN_FREQ,
    BS1_POINTS,
    `Frequency higher than expected for the disorder (${String(BS1_MIN_FREQ)} < freq=${String(freq)} <= ${String(BA1_MIN_FREQ)}).`,
  );
  mark(
    'BP4',
    score < BP4_MAX_SCORE,
    BP4_POINTS,
    `Computational evidence suggests a benign effect (score < ${String(BP4_MAX_SCORE)}).`,
  );

  // `points` is still the true sum when BA1 fires — the source reports it
  // unchanged, and so do we. Only the classification is overridden.
  const classification: AcmgClassification = ba1 ? 'Benign' : bandForPoints(points);
  return { classification, points, criteria };
}
