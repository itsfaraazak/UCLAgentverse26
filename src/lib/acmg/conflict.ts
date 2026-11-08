/**
 * Disagreement between a fresh ACMG call and the call already on record.
 * Ported from `deltagene/agents/conflict_agent.py` on
 * `feature/deltagene-prototype`.
 *
 * The line that matters is the one between {Pathogenic, Likely Pathogenic} and
 * {Uncertain Significance, Likely Benign, Benign}: crossing it is what changes
 * clinical action. That is the documented failure mode the source cites —
 * Oliver et al. 2020 found 47.4% of shared epilepsy-gene ClinVar variants had
 * some conflicting interpretation and 3.2% were "clinically substantial",
 * crossing the Uncertain-Significance line; the SHaRe hypertrophic-
 * cardiomyopathy consortium data found 45.2% discordance among ordinary
 * clinical labs.
 *
 * The prior call comes from a fixture field, not a live ClinVar query.
 * A disagreement that stays on one side of the line (Pathogenic -> Likely
 * Pathogenic, Benign -> Likely Benign) is still recorded as a conflict but
 * does not cross the threshold, and so does not escalate.
 */

import type { AcmgClassification } from './types';

const ACTIONABLE: ReadonlySet<AcmgClassification> = new Set<AcmgClassification>([
  'Pathogenic',
  'Likely Pathogenic',
]);

export function isActionable(classification: AcmgClassification): boolean {
  return ACTIONABLE.has(classification);
}

/** No prior on record means nothing to disagree with, so nothing crosses. */
export function crossesActionableThreshold(
  prior: AcmgClassification | null,
  next: AcmgClassification,
): boolean {
  if (prior === null) return false;
  return isActionable(prior) !== isActionable(next);
}

export interface ConflictAssessment {
  readonly conflict: boolean;
  readonly priorClassification: AcmgClassification | null;
  readonly newClassification: AcmgClassification;
  readonly crossesActionableThreshold: boolean;
  readonly note: string;
}

export function assessConflict(
  prior: AcmgClassification | null,
  next: AcmgClassification,
): ConflictAssessment {
  const conflict = prior !== null && prior !== next;
  const crossed = crossesActionableThreshold(prior, next);
  let note: string;
  if (prior === null) {
    note = 'No prior classification on record -- nothing to disagree with.';
  } else if (!conflict) {
    note = `Agrees with prior call ('${prior}').`;
  } else if (crossed) {
    note =
      `Disagrees with prior call ('${prior}' -> '${next}'); crosses the actionable ` +
      'Pathogenic/Uncertain line -- treatment decisions could change.';
  } else {
    note =
      `Disagrees with prior call ('${prior}' -> '${next}'); stays on the same side ` +
      'of the actionable line.';
  }
  return {
    conflict,
    priorClassification: prior,
    newClassification: next,
    crossesActionableThreshold: crossed,
    note,
  };
}
