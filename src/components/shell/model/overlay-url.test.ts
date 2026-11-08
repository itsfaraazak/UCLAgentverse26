/**
 * The URL is now untrusted input that reaches branch creation, so these tests
 * are about what it cannot do, not about the happy path alone.
 *
 * The vocabulary is taken from the real fixture rather than invented, so an
 * "unknown edit" here is genuinely one `data/loci.json` does not carry.
 */

import { describe, expect, it } from 'vitest';

import { buildWorkspace } from './workspace';
import {
  MAX_BRANCH_NAME,
  MAX_OVERLAY,
  MAX_RAW_ENTRIES,
  MAX_RAW_ENTRY,
  OVERLAY_PARAM,
  carriedOverlayParams,
  encodeOverlay,
  parseOverlay,
  validateOverlay,
  withOverlay,
  type OverlayVocabulary,
} from './overlay-url';
import type { BranchSpec } from './types';

const base = buildWorkspace();

const vocabulary: OverlayVocabulary = {
  branches: new Set(base.branches.map((b) => b.name)),
  variants: new Set(
    base.variants
      .map((v) => v.variantId)
      .filter((id): id is string => id !== null),
  ),
};

const knownVariant = (() => {
  const first = [...vocabulary.variants][0];
  if (first === undefined) throw new Error('fixture carries no curated variant');
  return first;
})();

/**
 * A second, different curated variant. Chaining the *same* variant onto a
 * line that already applies it is refused by `applyVariant` — its ref codon no
 * longer matches — so a chain test has to stack two different edits.
 */
const secondVariant = (() => {
  const second = [...vocabulary.variants][1];
  if (second === undefined) throw new Error('fixture carries only one variant');
  return second;
})();

/** The params a browser would hand `searchParams` for a given query string. */
function paramsOf(query: string): readonly string[] {
  return new URLSearchParams(query).getAll(OVERLAY_PARAM);
}

function parseQuery(query: string) {
  return parseOverlay(paramsOf(query), vocabulary);
}

describe('round-tripping specs through the URL', () => {
  it('encodes and parses back the specs it was given', () => {
    const specs: readonly BranchSpec[] = [
      { name: 'line/my-proposal', from: base.defaultBranch, variantId: knownVariant },
      { name: 'line/probe', from: 'line/my-proposal', variantId: knownVariant },
    ];

    const parsed = parseQuery(encodeOverlay(specs));

    expect(parsed.kind).toBe('ok');
    expect(parsed.specs).toEqual(specs);
  });

  it('round-trips a name with the separator-adjacent characters the rules allow', () => {
    // `/`, `.`, `_` and `-` are all legal in a branch name and all have to
    // survive the encoding, since the field separator is a bare colon.
    const specs: readonly BranchSpec[] = [
      { name: 'line/a.b_c-d/e', from: base.defaultBranch, variantId: knownVariant },
    ];
    const query = encodeOverlay(specs);

    expect(query).not.toContain('/line');
    expect(parseQuery(query).specs).toEqual(specs);
  });

  it('appends to an href that already has a query, and leaves a bare one alone', () => {
    const specs: readonly BranchSpec[] = [
      { name: 'line/a', from: base.defaultBranch, variantId: knownVariant },
    ];
    expect(withOverlay('/bench', [])).toBe('/bench');
    expect(withOverlay('/bench', specs)).toBe(`/bench?${encodeOverlay(specs)}`);
    expect(withOverlay('/bench?tab=run', specs)).toBe(
      `/bench?tab=run&${encodeOverlay(specs)}`,
    );
  });

  it('treats a single param and a repeated param the same way', () => {
    const one: readonly BranchSpec[] = [
      { name: 'line/solo', from: base.defaultBranch, variantId: knownVariant },
    ];
    const asString = parseOverlay(
      `line%2Fsolo:${base.defaultBranch}:${knownVariant}`,
      vocabulary,
    );
    expect(asString.specs).toEqual(one);
  });

  it('is empty, and not degraded, when the URL carries no overlay', () => {
    const parsed = parseOverlay(undefined, vocabulary);
    expect(parsed.kind).toBe('ok');
    expect(parsed.specs).toEqual([]);
  });
});

describe('a malformed URL degrades instead of throwing', () => {
  it('drops an entry with the wrong field count rather than coercing it', () => {
    for (const entry of [
      'line%2Fa',
      `line%2Fa:${base.defaultBranch}`,
      `line%2Fa:${base.defaultBranch}:${knownVariant}:extra`,
      `:${base.defaultBranch}:${knownVariant}`,
      `line%2Fa::${knownVariant}`,
      `line%2Fa:${base.defaultBranch}:`,
    ]) {
      const parsed = parseQuery(`${OVERLAY_PARAM}=${entry}`);
      expect(parsed.kind, entry).toBe('degraded');
      expect(parsed.specs, entry).toEqual([]);
    }
  });

  it('drops a name that is not a legal branch name', () => {
    const parsed = parseQuery(
      `${OVERLAY_PARAM}=${encodeURIComponent('../../etc/passwd')}:${
        base.defaultBranch
      }:${knownVariant}`,
    );
    expect(parsed.kind).toBe('degraded');
    expect(parsed.specs).toEqual([]);
  });

  it('drops an over-long name', () => {
    const parsed = parseQuery(
      `${OVERLAY_PARAM}=${'a'.repeat(MAX_BRANCH_NAME + 1)}:${base.defaultBranch}:${knownVariant}`,
    );
    expect(parsed.kind).toBe('degraded');
    expect(parsed.specs).toEqual([]);
  });

  it('validates `from` too, not just the name', () => {
    // `from` selects the base commit, so it is held to the same rules.
    const parsed = parseQuery(
      `${OVERLAY_PARAM}=line%2Fok:${encodeURIComponent('../main')}:${knownVariant}`,
    );
    expect(parsed.kind).toBe('degraded');
    expect(parsed.specs).toEqual([]);
  });

  it('drops a source branch that does not exist', () => {
    const parsed = parseQuery(
      `${OVERLAY_PARAM}=line%2Fok:line%2Fnot-there:${knownVariant}`,
    );
    expect(parsed.kind).toBe('degraded');
    expect(parsed.specs).toEqual([]);
    if (parsed.kind === 'degraded') {
      expect(parsed.dropped).toEqual([{ reason: 'unknown-source', count: 1 }]);
    }
  });

  it('drops a name that collides with a branch the fixture already has', () => {
    const existing = base.branches[0];
    if (existing === undefined) throw new Error('fixture has no branches');
    const parsed = parseQuery(
      `${OVERLAY_PARAM}=${encodeURIComponent(existing.name)}:${
        base.defaultBranch
      }:${knownVariant}`,
    );
    expect(parsed.kind).toBe('degraded');
    if (parsed.kind === 'degraded') {
      expect(parsed.dropped).toEqual([{ reason: 'duplicate', count: 1 }]);
    }
  });

  it('survives a broken percent-encoding', () => {
    const parsed = parseQuery(`${OVERLAY_PARAM}=line%2:${base.defaultBranch}:x`);
    expect(parsed.kind).toBe('degraded');
    expect(parsed.specs).toEqual([]);
  });

  it('keeps the valid entries and reports only the rest', () => {
    const good = `line%2Fkeep:${base.defaultBranch}:${knownVariant}`;
    const parsed = parseQuery(`${OVERLAY_PARAM}=${good}&${OVERLAY_PARAM}=nonsense`);

    expect(parsed.kind).toBe('degraded');
    expect(parsed.specs).toEqual([
      { name: 'line/keep', from: base.defaultBranch, variantId: knownVariant },
    ]);
    if (parsed.kind === 'degraded') {
      expect(parsed.dropped).toEqual([{ reason: 'malformed', count: 1 }]);
    }
  });
});

describe('an unknown variant lands in the dropped path', () => {
  it('drops it rather than letting requireVariant throw out of buildWorkspace', () => {
    const parsed = parseQuery(
      `${OVERLAY_PARAM}=line%2Fok:${base.defaultBranch}:NOT_A_VARIANT`,
    );

    expect(parsed.kind).toBe('degraded');
    expect(parsed.specs).toEqual([]);
    if (parsed.kind === 'degraded') {
      expect(parsed.dropped).toEqual([{ reason: 'unknown-edit', count: 1 }]);
    }
    // The guarantee behind the drop: this is what the page would otherwise
    // have rendered into.
    expect(() =>
      buildWorkspace([
        { name: 'line/ok', from: base.defaultBranch, variantId: 'NOT_A_VARIANT' },
      ]),
    ).toThrow(/not in data\/loci\.json/);
  });

  it('whatever survives parsing can actually be built', () => {
    const specs: readonly BranchSpec[] = [
      { name: 'line/a', from: base.defaultBranch, variantId: knownVariant },
      { name: 'line/b', from: 'line/a', variantId: secondVariant },
    ];
    const parsed = parseQuery(encodeOverlay(specs));
    const workspace = buildWorkspace(parsed.specs);

    expect(workspace.branches.map((b) => b.name)).toContain('line/a');
    expect(workspace.branches.map((b) => b.name)).toContain('line/b');
    // Each created line carries its own check, bound to its own commit.
    for (const name of ['line/a', 'line/b']) {
      const created = workspace.branches.find((b) => b.name === name);
      expect(created?.run).not.toBeNull();
      expect(created?.run?.check.commit).toBe(created?.head);
    }
  });
});

describe('a URL the parser accepts but the model refuses', () => {
  it('is possible, which is why the page replays inside a try/catch', () => {
    // Stacking the same variant twice is well-formed by every rule the parser
    // owns — legal names, a resolvable source, a curated edit — and still
    // cannot be built, because the ref codon has already been edited. The
    // parser does not duplicate `applyVariant`'s precondition; `src/app/page.tsx`
    // degrades to the base workspace if the build refuses, so this surfaces as
    // a note rather than an unhandled error on the page.
    const specs: readonly BranchSpec[] = [
      { name: 'line/a', from: base.defaultBranch, variantId: knownVariant },
      { name: 'line/b', from: 'line/a', variantId: knownVariant },
    ];
    const parsed = parseQuery(encodeOverlay(specs));

    expect(parsed.kind).toBe('ok');
    expect(() => buildWorkspace(parsed.specs)).toThrow(/refCodon mismatch/);
  });
});

describe('an oversized URL is bounded before it is parsed', () => {
  it('caps the parsed list at MAX_OVERLAY', () => {
    const entries = Array.from(
      { length: MAX_OVERLAY + 5 },
      (_, i) =>
        `${OVERLAY_PARAM}=line%2Fp${i}:${base.defaultBranch}:${knownVariant}`,
    ).join('&');

    const parsed = parseQuery(entries);

    expect(parsed.specs).toHaveLength(MAX_OVERLAY);
    expect(parsed.kind).toBe('degraded');
    if (parsed.kind === 'degraded') {
      expect(parsed.dropped).toEqual([{ reason: 'over-capacity', count: 5 }]);
    }
  });

  it('refuses the excess of a param flood without splitting it', () => {
    const flood = Array.from(
      { length: MAX_RAW_ENTRIES + 40 },
      () => `${OVERLAY_PARAM}=x`,
    ).join('&');

    const parsed = parseQuery(flood);

    expect(parsed.specs).toEqual([]);
    expect(parsed.kind).toBe('degraded');
    if (parsed.kind === 'degraded') {
      const total = parsed.dropped.reduce((sum, d) => sum + d.count, 0);
      expect(total).toBe(MAX_RAW_ENTRIES + 40);
    }
  });

  it('rejects an entry longer than the raw cap', () => {
    const parsed = parseQuery(`${OVERLAY_PARAM}=${'a'.repeat(MAX_RAW_ENTRY + 1)}`);
    expect(parsed.specs).toEqual([]);
    expect(parsed.kind).toBe('degraded');
  });
});

describe('the note never echoes the input', () => {
  it('reports counts and categories only', () => {
    const parsed = parseQuery(
      `${OVERLAY_PARAM}=${encodeURIComponent('<script>alert(1)</script>')}:${
        base.defaultBranch
      }:${knownVariant}&${OVERLAY_PARAM}=line%2Fok:${base.defaultBranch}:SECRET_VARIANT`,
    );

    expect(parsed.kind).toBe('degraded');
    if (parsed.kind !== 'degraded') return;
    expect(parsed.note).not.toContain('script');
    expect(parsed.note).not.toContain('alert');
    expect(parsed.note).not.toContain('SECRET_VARIANT');
    expect(parsed.note).toContain('2 created lines');
  });
});

describe('carrying the overlay across a surface that cannot resolve it', () => {
  it('re-emits a valid entry in the same canonical form the shell writes', () => {
    const specs: readonly BranchSpec[] = [
      { name: 'line/my-proposal', from: base.defaultBranch, variantId: knownVariant },
    ];
    // What `useSearchParams().getAll()` hands it: already decoded.
    const decoded = paramsOf(encodeOverlay(specs));

    expect(carriedOverlayParams(decoded).map((p) => `${OVERLAY_PARAM}=${p}`)).toEqual([
      encodeOverlay(specs),
    ]);
  });

  it('refuses to copy a shape-invalid entry into a link', () => {
    // A link built from raw params put an invalid name from the URL straight
    // back into an href. Nothing unresolvable may be carried.
    const hostile = [
      '<script>alert(1)</script>:main:HBB_HbS',
      '../../etc/passwd:main:HBB_HbS',
      'line/ok:../main:HBB_HbS',
      'line/ok:main:not a variant id',
      'line/ok:main',
      'a'.repeat(MAX_RAW_ENTRY + 1),
    ];

    expect(carriedOverlayParams(hostile)).toEqual([]);
  });

  it('keeps the valid entries out of a mixed list and caps the rest', () => {
    const good = `${'line/keep'}:${base.defaultBranch}:${knownVariant}`;
    const carried = carriedOverlayParams([good, 'junk', good]);

    // The duplicate is not this function's business — the server drops it —
    // but every entry it emits is shape-valid and canonically encoded.
    expect(carried).toHaveLength(2);
    for (const entry of carried) {
      expect(entry).toBe(
        ['line/keep', base.defaultBranch, knownVariant]
          .map(encodeURIComponent)
          .join(':'),
      );
    }
    expect(
      carriedOverlayParams(Array.from({ length: 500 }, () => good)),
    ).toHaveLength(MAX_OVERLAY);
  });

  it('round-trips through the switcher back into the parser', () => {
    const specs: readonly BranchSpec[] = [
      { name: 'line/a', from: base.defaultBranch, variantId: knownVariant },
      { name: 'line/b', from: 'line/a', variantId: secondVariant },
    ];
    // `/` → `/bench` → `/` : encode, decode, carry, parse.
    const carried = carriedOverlayParams(paramsOf(encodeOverlay(specs)));
    const query = carried.map((p) => `${OVERLAY_PARAM}=${p}`).join('&');

    expect(parseQuery(query).specs).toEqual(specs);
  });
});

describe('validateOverlay is the one copy of the rules', () => {
  it('refuses on the action path what the URL parser drops', () => {
    const valid: BranchSpec = {
      name: 'line/probe',
      from: base.defaultBranch,
      variantId: knownVariant,
    };

    expect(() => validateOverlay([valid])).not.toThrow();
    expect(() =>
      validateOverlay([{ ...valid, name: '../../etc/passwd' }]),
    ).toThrow(/letters, digits/);
    expect(() =>
      validateOverlay([{ ...valid, from: '../../etc/passwd' }]),
    ).toThrow(/letters, digits/);
    expect(() =>
      validateOverlay([{ ...valid, name: 'a'.repeat(MAX_BRANCH_NAME + 1) }]),
    ).toThrow(/64 characters/);
    expect(() => validateOverlay([valid, valid])).toThrow(/twice/);
    expect(() =>
      validateOverlay(
        Array.from({ length: MAX_OVERLAY + 1 }, (_, i) => ({
          ...valid,
          name: `line/p${i}`,
        })),
      ),
    ).toThrow(/At most 25/);
  });
});
