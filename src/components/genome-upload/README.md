# `components/genome-upload` — bring your own genome

Paste a coding sequence or drop a FASTA file. The upload is screened by
`lib/safety` **before anything else reads it**, validated against
`lib/genome`'s rules, and handed back as a `GenomeModel` ready for the 3D
view. The preloaded demo genome stays the default; upload is secondary.

```tsx
'use client';
import { useState } from 'react';
import { GenomeUpload } from '@/components/genome-upload';
import { GenomeHelix3D, type GenomeModel } from '@/components/genome-3d';

export function GenomePanel() {
  const [uploaded, setUploaded] = useState<GenomeModel | null>(null);
  return (
    <>
      <GenomeUpload onGenomeChange={setUploaded} />
      {/* `model` undefined ⇒ the curated HBB fixture. */}
      <GenomeHelix3D model={uploaded ?? undefined} />
    </>
  );
}
```

`onGenomeChange` fires with a model built from the curated reference vs the
uploaded sequence, or `null` when the user resets to the demo genome. The
component is props-driven and layout-agnostic; it works down to ~320px wide.

## Props

| prop | default | |
|---|---|---|
| `gene` | `HBB` | the curated locus an upload is compared against |
| `onGenomeChange` | — | `(GenomeModel \| null) => void` |
| `onSequenceChange` | — | `(ValidatedSequence \| null) => void` |
| `className` | — | merged onto the outer `<section>` |

## Order of operations — this is the point

1. **`screenUpload()` runs first**, on the raw text, before it is parsed,
   validated, diffed, translated, rendered or stored (SPEC §7.4). It is the
   only entry point into this directory's pipeline.
2. A **`block`** verdict ends it. The text is discarded, the textarea is
   cleared, and only the policy **category** and the **generic reason** are
   shown (SPEC §7.3).
3. An **`escalate`** verdict does not auto-approve. The sequence is held
   behind an explicit *"Acknowledge and load anyway"* action, with the
   required sign-off role named (SPEC §7.5).
4. Only then: `parseFasta` → `validateSequence` → `buildGenomeModel`.

### Refused input cannot be echoed, by construction

`ScreenedUpload` is a discriminated union whose refused branch has **no
`text` field at all** — not an empty string, not a redacted placeholder. The
uploaded text is unreachable from a blocked result, so the UI cannot render
it even by mistake. `screening.test.ts` asserts both the type-level absence
(`'text' in result === false`) and that a sentinel planted in the input never
appears anywhere in the serialised result.

The filename is screened too, since it is user-supplied text that can carry
intent just as a FASTA header can. Filenames separate words with `-`, `_`
and `.`, which plain phrase matching would miss, so separators are
normalised to spaces before screening — this makes the gate catch strictly
*more*; it adds no policy and changes no verdict.

### `lib/safety` is not modified

This directory adds no policy categories, defines no verdicts and never
downgrades one. `screening.ts` maps a `ScreenResult` onto a renderable shape
and nothing else. Mechanical input failures (bad file, unknown locus,
unreadable file) deliberately carry **no** screening object, so the UI never
shows a category that `screen()` did not actually return.

## Session-only

Uploaded data lives in React state and dies with the page. The component
never touches `localStorage` or `sessionStorage`, never issues a network
request, and says so in the UI. `GenomeUpload.test.tsx` asserts no storage
write and no `fetch` call across a full successful upload.

## Validation, as friendly inline text

`lib/genome`'s errors are caught and turned into one or two plain sentences —
never a stack trace, never an error class name:

| input | what the user sees |
|---|---|
| non-ACGT (SPEC §4.6 #13) | names the character and its 1-based position, says the position counts the *assembled* sequence after any FASTA header and line breaks were removed, and — for an `N`, a `U` or an IUPAC code — why that specific character is refused |
| length not a multiple of 3 (SPEC §4.6 #14) | explains that this view diffs whole codons, and how many bases are extra. The sequence is **not** truncated to fit |
| more than one FASTA record | says how many were found and asks for one at a time; the first record is never silently used |
| over the cap | states the limit and the observed size |

Non-fatal observations are surfaced as warnings and still load: no `ATG`
start codon, an internal stop codon, no stop codon (the 31-codon HBB fixture
legitimately has none), and a codon count differing from the reference.

## Caps

`UPLOAD_LIMITS` re-exports `lib/genome`'s `MAX_SEQUENCE_BASES` and
`MAX_UPLOAD_CHARS` rather than declaring its own, so the number the UI states
is the number that is enforced — a test asserts those stay equal. A file over
the raw cap is refused on `file.size` *before* it is opened.

## Files

| file | |
|---|---|
| `GenomeUpload.tsx` | the component: drop zone, paste box, verdict surfaces |
| `screening.ts` | the gate. The only path in. Owns the non-echo guarantee |
| `validate.ts` | `lib/genome`'s parser and rules as a discriminated result, never throwing |

Parsing itself lives in **`lib/genome/fasta.ts`**, not here. This directory
briefly carried its own FASTA reader; when the shared one landed it became a
second copy with *different* size caps, which would have printed a limit the
app did not enforce. It was deleted. `validate.ts` now wraps
`parseSequenceUpload` and keeps only what is genuinely presentational: the
discriminated result, the friendly sentences, and the warnings layer.

Colour is never the only signal on a verdict: each notice pairs its
`--verdict-*` tone with a lucide icon and a text label.
