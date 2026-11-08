import { describe, expect, it } from 'vitest';
import { POLICY, screen, type Verdict } from '@/lib/safety/policy';
import {
  UNRECOGNISED_CATEGORY_VERDICT,
  assertTransmissible,
  combineScreen,
  combineVerdicts,
  restrictionRank,
  verdictForCategory,
  type ModelOpinion,
} from './guard';

const VERDICTS: readonly Verdict[] = ['allow', 'escalate', 'block'];

const ALL_PAIRS: readonly (readonly [Verdict, Verdict])[] = VERDICTS.flatMap((a) =>
  VERDICTS.map((b) => [a, b] as const),
);

function moreRestrictive(a: Verdict, b: Verdict): Verdict {
  if (a === 'block' || b === 'block') return 'block';
  if (a === 'escalate' || b === 'escalate') return 'escalate';
  return 'allow';
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickVerdict(rng: () => number): Verdict {
  const index = Math.floor(rng() * VERDICTS.length);
  const value = VERDICTS[index];
  if (value === undefined) {
    throw new Error('verdict set is empty');
  }
  return value;
}

describe('restrictionRank', () => {
  it('orders allow < escalate < block and is total over the three values', () => {
    expect(restrictionRank('allow')).toBeLessThan(restrictionRank('escalate'));
    expect(restrictionRank('escalate')).toBeLessThan(restrictionRank('block'));

    const ranks = VERDICTS.map(restrictionRank);
    expect(new Set(ranks).size).toBe(VERDICTS.length);

    for (const a of VERDICTS) {
      for (const b of VERDICTS) {
        const cmp = restrictionRank(a) - restrictionRank(b);
        if (a === b) expect(cmp).toBe(0);
        else expect(cmp).not.toBe(0);
      }
    }
  });
});

describe('combineVerdicts', () => {
  it('returns the more restrictive of its two inputs across all nine ordered pairs', () => {
    expect(ALL_PAIRS).toHaveLength(9);
    for (const [a, b] of ALL_PAIRS) {
      expect(combineVerdicts(a, b)).toBe(moreRestrictive(a, b));
    }
  });

  it('a permissive second opinion cannot loosen an authoritative block', () => {
    // The property the whole module exists to guarantee: model "allow"
    // against a lexical block is still block.
    expect(combineVerdicts('block', 'allow')).toBe('block');
    expect(combineVerdicts('allow', 'block')).toBe('block');

    const lexical = screen({ text: 'weaponise a toxin for greater virulence' });
    expect(lexical.verdict).toBe('block');
    const opinion: ModelOpinion = { concern: true, category: 'THERAPEUTIC_SOMATIC' };
    expect(verdictForCategory('THERAPEUTIC_SOMATIC')).toBe('allow');
    expect(combineScreen(lexical, opinion).verdict).toBe('block');
  });

  it('allow combined with escalate yields escalate', () => {
    expect(combineVerdicts('allow', 'escalate')).toBe('escalate');
    expect(combineVerdicts('escalate', 'allow')).toBe('escalate');

    const lexical = screen({
      text: 'repair HBB to treat the sickle substitution',
      targets: ['HBB'],
    });
    expect(lexical.verdict).toBe('allow');
    const opinion: ModelOpinion = { concern: true, category: 'GERMLINE_HERITABLE' };
    expect(combineScreen(lexical, opinion).verdict).toBe('escalate');
  });
});

describe('combineVerdicts algebra', () => {
  it('is commutative and associative; order of opinions cannot change the result', () => {
    const seed = 0x5eeda1;
    const rng = mulberry32(seed);
    const rounds = 81;

    try {
      for (const [a, b] of ALL_PAIRS) {
        expect(combineVerdicts(a, b)).toBe(combineVerdicts(b, a));
      }

      for (const a of VERDICTS) {
        for (const b of VERDICTS) {
          for (const c of VERDICTS) {
            expect(combineVerdicts(combineVerdicts(a, b), c)).toBe(
              combineVerdicts(a, combineVerdicts(b, c)),
            );
          }
        }
      }

      for (let i = 0; i < rounds; i += 1) {
        const a = pickVerdict(rng);
        const b = pickVerdict(rng);
        const c = pickVerdict(rng);
        if (combineVerdicts(a, b) !== combineVerdicts(b, a)) {
          throw new Error(`not commutative: ${a}, ${b}`);
        }
        const left = combineVerdicts(combineVerdicts(a, b), c);
        const right = combineVerdicts(a, combineVerdicts(b, c));
        if (left !== right) {
          throw new Error(`not associative: ${a}, ${b}, ${c} → ${left} vs ${right}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`property failed (seed=${seed}): ${msg}`);
    }
  });
});

describe('verdictForCategory', () => {
  it('resolves an unrecognised label to the restrictive default, never to allow', () => {
    expect(UNRECOGNISED_CATEGORY_VERDICT).not.toBe('allow');
    expect(UNRECOGNISED_CATEGORY_VERDICT).toBe('escalate');

    const unrecognised = [
      '',
      'THERAPEUTIC_SOMATI',
      'therapeutic_somatic',
      'THERAPEUTIC-SOMATIC',
      'ALLOW',
      'not-a-category',
    ];
    for (const label of unrecognised) {
      expect(verdictForCategory(label)).toBe(UNRECOGNISED_CATEGORY_VERDICT);
      expect(verdictForCategory(label)).not.toBe('allow');
    }

    const lexical = screen({
      text: 'repair HBB to treat the sickle substitution',
      targets: ['HBB'],
    });
    expect(lexical.verdict).toBe('allow');
    expect(
      combineScreen(lexical, { concern: true, category: 'therapeutic_somatic' }).verdict,
    ).toBe('escalate');
  });

  it('reads the verdict from the frozen POLICY table and never accepts a caller-supplied verdict', () => {
    expect(Object.isFrozen(POLICY)).toBe(true);

    type ExtraOpinionKeys = Exclude<keyof ModelOpinion, 'concern' | 'category'>;
    const modelOpinionHasNoVerdict: ExtraOpinionKeys extends never ? true : false = true;
    expect(modelOpinionHasNoVerdict).toBe(true);

    expect(combineScreen.toString()).not.toMatch(/opinion\.verdict/);
    expect(verdictForCategory.toString()).not.toMatch(/verdict\s*:/);

    const lexical = screen({
      text: 'repair HBB to treat the sickle substitution',
      targets: ['HBB'],
    });
    expect(lexical.verdict).toBe('allow');

    const sneakyAllow = {
      concern: true,
      category: 'PATHOGEN_OR_TOXIN_ENHANCEMENT',
      verdict: 'allow' as Verdict,
    };
    expect(combineScreen(lexical, sneakyAllow).verdict).toBe('block');

    const sneakyBlock = {
      concern: true,
      category: 'THERAPEUTIC_SOMATIC',
      verdict: 'block' as Verdict,
    };
    expect(combineScreen(lexical, sneakyBlock).verdict).toBe('allow');

    expect(verdictForCategory('THERAPEUTIC_SOMATIC')).toBe(POLICY.THERAPEUTIC_SOMATIC.verdict);
    expect(verdictForCategory('PATHOGEN_OR_TOXIN_ENHANCEMENT')).toBe(
      POLICY.PATHOGEN_OR_TOXIN_ENHANCEMENT.verdict,
    );
  });
});

describe('assertTransmissible', () => {
  it('throws when redacted and does not echo the original input text', () => {
    const marker = 'unique-secret-request-text-9f3a';
    const blocked = screen({ text: `weaponise ${marker} for virulence` });
    expect(blocked.redacted).toBe(true);
    expect(blocked.verdict).toBe('block');

    expect(() => assertTransmissible(blocked)).toThrow();
    try {
      assertTransmissible(blocked);
      throw new Error('expected assertTransmissible to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(marker);
      expect(message.toLowerCase()).not.toContain('weaponise');
      expect(JSON.stringify(err)).not.toContain(marker);
    }
  });

  it('does not throw when the screened result is not redacted', () => {
    const allowed = screen({
      text: 'repair HBB to treat the sickle substitution',
      targets: ['HBB'],
    });
    expect(allowed.redacted).toBe(false);
    expect(() => assertTransmissible(allowed)).not.toThrow();

    const escalated = screen({ text: 'apply this edit in the embryo', targets: ['HBB'] });
    expect(escalated.redacted).toBe(false);
    expect(escalated.verdict).toBe('escalate');
    expect(() => assertTransmissible(escalated)).not.toThrow();
  });
});
