/**
 * The SigmaFold workspace.
 *
 * A server component whose only job is composition: build the workspace from
 * the real modules and hand it to the client shell. Resolving the data here
 * rather than in the browser is not an optimisation — `lib/vcs`, `lib/agents`
 * and `lib/safety` reach `node:crypto` and cannot run client-side at all.
 *
 * Created genotype lines arrive as repeated `line` search params and are
 * replayed here, so they survive a navigation to another surface and a
 * reload. See `components/shell/model/overlay-url.ts` for the form and the
 * rules. Reading `searchParams` makes this route request-dependent, so the
 * part that reads it sits under a `<Suspense>` boundary: the chrome around it
 * still prerenders, and the boundary's fallback is one line of text rather
 * than a mock-up of the shell.
 */

import { Suspense } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { buildWorkspace } from '@/components/shell/model/workspace';
import {
  OVERLAY_PARAM,
  parseOverlay,
  type OverlayParse,
} from '@/components/shell/model/overlay-url';
import type { BranchSpec, WorkspaceView } from '@/components/shell/model/types';

type SearchParams = Record<string, string | string[] | undefined>;

export default function Home({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  return (
    <Suspense fallback={<Restoring />}>
      <Workspace searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * The boundary's fallback. Deliberately not a skeleton of the three-pane
 * shell: a frame with placeholder rows would read as content that is there,
 * which is the one thing it is not.
 */
function Restoring() {
  return (
    <main className="flex h-dvh items-center justify-center p-8 text-center">
      <p className="work__sub">Building the workspace…</p>
    </main>
  );
}

async function Workspace({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  // The base workspace is both the vocabulary the URL is checked against and
  // the thing a bad URL degrades to. `seeded()` inside the model memoises the
  // fixture build, so having it in hand before the overlay is replayed is
  // cheap.
  const base = buildWorkspace();
  const parsed = parseOverlay(
    (await searchParams)[OVERLAY_PARAM],
    vocabulary(base),
  );

  const { workspace, overlay, note } = replay(base, parsed);

  return <AppShell workspace={workspace} overlay={overlay} overlayNote={note} />;
}

function vocabulary(base: WorkspaceView) {
  const variants = new Set<string>();
  for (const variant of base.variants) {
    if (variant.variantId !== null) variants.add(variant.variantId);
  }
  return {
    branches: new Set(base.branches.map((b) => b.name)),
    variants,
  };
}

/**
 * Replay the validated specs, degrading to the base workspace rather than
 * letting anything throw into the page.
 *
 * Every entry here has already been shape-checked and resolved against the
 * fixture, so `buildWorkspace` is not expected to refuse them. It is still
 * wrapped: it is the module that owns what a legal overlay is, and a URL that
 * gets past the parser but not past the model must produce a workspace and a
 * note, never a half-built render or a server error. The specs are not
 * re-listed in the note — the reason is reported by category only.
 */
function replay(
  base: WorkspaceView,
  parsed: OverlayParse,
): {
  readonly workspace: WorkspaceView;
  readonly overlay: readonly BranchSpec[];
  readonly note: string | null;
} {
  const note = parsed.kind === 'degraded' ? parsed.note : null;
  if (parsed.specs.length === 0) {
    return { workspace: base, overlay: [], note };
  }
  try {
    return { workspace: buildWorkspace(parsed.specs), overlay: parsed.specs, note };
  } catch {
    return {
      workspace: base,
      overlay: [],
      note: 'The created lines in this link could not be rebuilt, so this is the base workspace. Create the line again to get it back.',
    };
  }
}
