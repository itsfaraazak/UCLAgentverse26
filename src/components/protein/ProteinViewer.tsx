'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Crosshair, Info, RotateCcw, RotateCw, Scan, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  describeChange,
  resolveResidueChange,
  titleCase3,
  type ResidueChange,
  type StructureOption,
} from './fixture';
import { defaultPdbLoader, type PdbLoader } from './pdb-source';
import { loadProteinEngine } from './load-engine';
import { classifyFailure, describe, isAbort, type FailureKind } from './runtime/errors';
import { FailurePanel, LoadingOverlay, RendererBadge } from './runtime/status-ui';
import type { RendererPreference } from './runtime/renderer';
import type { ProteinEngineHandle, RendererInfo, StructureSummary } from './engine';

export interface ProteinViewerProps {
  /** `loci.json` variant whose position/residues/annotation to show. Default `HBB_HbS`. */
  readonly variantId?: string;
  /** Override the CDS codon index (1-based). Hides fixture prose if it differs. */
  readonly codonIndex?: number;
  /** Override the reference amino acid (one-letter). */
  readonly refAa?: string;
  /** Override the alternate amino acid (one-letter). */
  readonly altAa?: string;
  /** Deposited structure carrying the *alternate* residue. Default `2HBS`. */
  readonly pdbId?: string;
  /** Deposited structure carrying the *reference* residue, offered as a
   *  toggle. Default `4HHB`; `null` hides the toggle. */
  readonly referencePdbId?: string | null;
  /** `'webgl'` forces the WebGL 2 path (e.g. to rehearse the fallback). */
  readonly renderer?: RendererPreference;
  /** Replace the RCSB download, e.g. with a same-origin copy for offline demos. */
  readonly loadPdb?: PdbLoader;
  /** Notified when the active renderer changes (`null` when none is live). */
  readonly onRendererChange?: (info: RendererInfo | null) => void;
  readonly className?: string;
}

type ViewerState =
  | { readonly phase: 'loading'; readonly step: 'download' | 'library' | 'gpu' }
  | { readonly phase: 'ready'; readonly renderer: RendererInfo; readonly structure: StructureSummary }
  | { readonly phase: 'error'; readonly kind: FailureKind; readonly detail: string };

const LOADING_LABEL = {
  download: 'Downloading structure…',
  library: 'Loading 3D library…',
  gpu: 'Starting GPU renderer…',
} as const;

const ORBIT_STEP = 0.18;
const ZOOM_STEP = 1.2;

function chainList(chains: readonly string[]): string {
  return chains.length === 0 ? 'none' : chains.join(', ');
}

function moleculesFor(structure: StructureSummary, chains: ReadonlySet<string>, include: boolean): string[] {
  return structure.molecules
    .filter((m) => m.chains.some((c) => chains.has(c) === include))
    .map((m) => m.molecule.toLowerCase());
}

export function ProteinViewer({
  variantId,
  codonIndex,
  refAa,
  altAa,
  pdbId = '2HBS',
  referencePdbId = '4HHB',
  renderer: prefer = 'auto',
  loadPdb = defaultPdbLoader,
  onRendererChange,
  className,
}: ProteinViewerProps) {
  const change = useMemo(
    () => resolveResidueChange({ variantId, codonIndex, refAa, altAa }),
    [variantId, codonIndex, refAa, altAa],
  );
  const options = useMemo<StructureOption[]>(() => {
    const list: StructureOption[] = [{ pdbId, carries: 'alt' }];
    if (referencePdbId !== null && referencePdbId !== pdbId) {
      list.push({ pdbId: referencePdbId, carries: 'ref' });
    }
    return list;
  }, [pdbId, referencePdbId]);

  const [selectedId, setSelectedId] = useState(pdbId);
  const active = options.find((o) => o.pdbId === selectedId) ?? options[0];
  const activeId = active?.pdbId ?? pdbId;
  const carries = active?.carries ?? 'alt';
  const expected = carries === 'alt' ? change.alt : change.ref;

  const [attempt, setAttempt] = useState(0);
  // State is tagged with the request it belongs to, so a new request (other
  // structure, retry, …) reads as "loading" without a synchronous reset.
  const requestKey = `${activeId}|${change.pdbResidueNumber}|${expected.three}|${prefer}|${attempt}`;
  const [tagged, setTagged] = useState<{ key: string; state: ViewerState } | null>(null);
  const state: ViewerState =
    tagged !== null && tagged.key === requestKey ? tagged.state : { phase: 'loading', step: 'download' };
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ProteinEngineHandle | null>(null);
  // Callbacks live in refs so an inline prop doesn't remount the GPU scene.
  const rendererCb = useRef(onRendererChange);
  const loaderRef = useRef(loadPdb);
  useEffect(() => {
    rendererCb.current = onRendererChange;
    loaderRef.current = loadPdb;
  }, [onRendererChange, loadPdb]);

  const ids = { title: useId(), alt: useId(), keys: useId() };

  useEffect(() => {
    const container = hostRef.current;
    if (container === null) return;
    const controller = new AbortController();
    const { signal } = controller;
    let handle: ProteinEngineHandle | null = null;
    const setState = (next: ViewerState): void => setTagged({ key: requestKey, state: next });

    const fail = (err: unknown): void => {
      if (signal.aborted || isAbort(err)) return;
      handle?.dispose();
      handle = null;
      handleRef.current = null;
      rendererCb.current?.(null);
      setState({ phase: 'error', kind: classifyFailure(err), detail: describe(err) });
    };

    // Start both in parallel; the no-op catch only marks the promise as
    // handled so a download failure doesn't leave the import rejection
    // unobserved. The real await below still sees the rejection.
    const enginePromise = loadProteinEngine();
    enginePromise.catch(() => undefined);

    void (async () => {
      try {
        const text = await loaderRef.current(activeId, signal);
        if (signal.aborted) return;
        setState({ phase: 'loading', step: 'library' });
        const engine = await enginePromise;
        if (signal.aborted) return;
        setState({ phase: 'loading', step: 'gpu' });
        const mounted = await engine.mountProteinEngine({
          container,
          pdbId: activeId,
          pdbText: text,
          residueNumber: change.pdbResidueNumber,
          expectedResName: expected.three,
          prefer,
          signal,
          onContextLost: fail,
        });
        if (signal.aborted) {
          mounted.dispose();
          return;
        }
        handle = mounted;
        handleRef.current = mounted;
        rendererCb.current?.(mounted.renderer);
        setState({ phase: 'ready', renderer: mounted.renderer, structure: mounted.structure });
      } catch (err) {
        fail(err);
      }
    })();

    return () => {
      controller.abort();
      handle?.dispose();
      handle = null;
      handleRef.current = null;
    };
  }, [activeId, change.pdbResidueNumber, expected.three, prefer, requestKey]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const ready = state.phase === 'ready';

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const handle = handleRef.current;
    if (handle === null) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => handle.orbit(-ORBIT_STEP, 0),
      ArrowRight: () => handle.orbit(ORBIT_STEP, 0),
      ArrowUp: () => handle.orbit(0, -ORBIT_STEP),
      ArrowDown: () => handle.orbit(0, ORBIT_STEP),
      '+': () => handle.zoom(ZOOM_STEP),
      '=': () => handle.zoom(ZOOM_STEP),
      '-': () => handle.zoom(1 / ZOOM_STEP),
      '0': () => handle.resetView(),
      Home: () => handle.resetView(),
      f: () => handle.focusResidue(),
    };
    const action = actions[event.key];
    if (action === undefined) return;
    event.preventDefault();
    action();
  };

  const residueLabel = `${titleCase3(expected.three)}${change.pdbResidueNumber}`;
  const highlighted = ready ? state.structure.highlightedChains : [];
  const viewLabel =
    `3D model of deposited structure PDB ${activeId}. ` +
    (ready && highlighted.length > 0
      ? `Residue ${residueLabel} (${expected.name}) is highlighted in magenta in chains ${chainList(highlighted)}. `
      : '') +
    'Arrow keys rotate, plus and minus zoom, 0 resets, F focuses the residue.';

  return (
    <section
      aria-labelledby={ids.title}
      data-slot="protein-viewer"
      className={cn(
        'flex w-full min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 text-card-foreground',
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id={ids.title} className="text-sm font-semibold leading-tight">
            Structure view · {change.gene} {residueLabel}
          </h2>
          <p className="text-xs text-muted-foreground">
            Deposited experimental structure (PDB {activeId}), not a prediction
          </p>
        </div>
        <RendererBadge
          state={
            state.phase === 'ready'
              ? { phase: 'active', ...state.renderer }
              : state.phase === 'loading'
                ? { phase: 'starting' }
                : { phase: 'none' }
          }
        />
      </header>

      {options.length > 1 && (
        <ToggleGroup
          aria-label="Structure"
          variant="outline"
          size="sm"
          spacing={0}
          value={[activeId]}
          onValueChange={(value: string[]) => {
            const next = value[0];
            if (next !== undefined) setSelectedId(next);
          }}
        >
          {options.map((o) => {
            const aa = o.carries === 'alt' ? change.alt : change.ref;
            return (
              <ToggleGroupItem key={o.pdbId} value={o.pdbId} className="px-2 text-xs">
                {titleCase3(aa.three)}
                {change.pdbResidueNumber} · {o.pdbId}
                <span className="sr-only">
                  {o.carries === 'alt' ? ' (carries the alternate residue)' : ' (carries the reference residue)'}
                </span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      )}

      <div className="relative aspect-[4/3] min-h-[200px] w-full overflow-hidden rounded-lg bg-muted/50">
        <div
          ref={hostRef}
          role="img"
          aria-label={viewLabel}
          aria-describedby={ids.alt}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + - 0 F"
          tabIndex={ready ? 0 : -1}
          onKeyDown={onKeyDown}
          className="absolute inset-0 cursor-grab rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:cursor-grabbing"
        />
        {state.phase === 'loading' && <LoadingOverlay label={LOADING_LABEL[state.step]} />}
        {state.phase === 'error' && (
          <FailurePanel kind={state.kind} detail={state.detail} onRetry={retry}>
            <p>
              <span className="font-medium">Residue change: </span>
              {describeChange(change)}.
            </p>
            {change.summary !== null && <p className="mt-1">{change.summary}</p>}
            <p className="mt-1 text-muted-foreground">
              The full text description is below.
            </p>
          </FailurePanel>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Structure view controls">
        <Button type="button" variant="outline" size="icon-sm" disabled={!ready} aria-label="Rotate left" title="Rotate left (←)" onClick={() => handleRef.current?.orbit(-ORBIT_STEP, 0)}>
          <RotateCcw aria-hidden="true" />
        </Button>
        <Button type="button" variant="outline" size="icon-sm" disabled={!ready} aria-label="Rotate right" title="Rotate right (→)" onClick={() => handleRef.current?.orbit(ORBIT_STEP, 0)}>
          <RotateCw aria-hidden="true" />
        </Button>
        <Button type="button" variant="outline" size="icon-sm" disabled={!ready} aria-label="Zoom in" title="Zoom in (+)" onClick={() => handleRef.current?.zoom(ZOOM_STEP)}>
          <ZoomIn aria-hidden="true" />
        </Button>
        <Button type="button" variant="outline" size="icon-sm" disabled={!ready} aria-label="Zoom out" title="Zoom out (−)" onClick={() => handleRef.current?.zoom(1 / ZOOM_STEP)}>
          <ZoomOut aria-hidden="true" />
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!ready || highlighted.length === 0} onClick={() => handleRef.current?.focusResidue()}>
          <Crosshair aria-hidden="true" />
          Focus {residueLabel}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!ready} onClick={() => handleRef.current?.resetView()}>
          <Scan aria-hidden="true" />
          Reset view
        </Button>
      </div>

      <Legend change={change} expectedLabel={residueLabel} expectedName={expected.name} state={state} />

      <TextAlternative id={ids.alt} change={change} state={state} activeId={activeId} />
    </section>
  );
}

function Swatch({ className }: { readonly className: string }) {
  return <span aria-hidden="true" className={cn('mt-1 inline-block size-2.5 shrink-0 rounded-full', className)} />;
}

function Legend({
  change,
  expectedLabel,
  expectedName,
  state,
}: {
  readonly change: ResidueChange;
  readonly expectedLabel: string;
  readonly expectedName: string;
  readonly state: ViewerState;
}) {
  const structure = state.phase === 'ready' ? state.structure : null;
  const carriers = new Set(structure?.highlightedChains ?? []);
  const carrierNames = structure ? moleculesFor(structure, carriers, true) : [];
  const otherNames = structure ? moleculesFor(structure, carriers, false) : [];
  return (
    <ul aria-label="Legend" className="grid gap-1 text-xs text-foreground/80">
      <li className="flex gap-2">
        <Swatch className="bg-[#e11d74]" />
        <span>
          <span className="font-medium">{expectedLabel}</span> ({expectedName}) — the position changed by the
          edit (codon {change.codonIndex} in CDS numbering)
          {structure && structure.highlightedChains.length > 0 && <>, in chains {chainList(structure.highlightedChains)}</>}
        </span>
      </li>
      <li className="flex gap-2">
        <Swatch className="bg-[#3b82f6]" />
        <span>
          Backbone of chains carrying that position
          {carrierNames.length > 0 && <> ({carrierNames.join(', ')})</>}
        </span>
      </li>
      <li className="flex gap-2">
        <Swatch className="bg-[#94a3b8]" />
        <span>
          Other chains{otherNames.length > 0 && <> ({otherNames.join(', ')})</>}; small spheres are hetero groups
          (e.g. haem) in element colours
        </span>
      </li>
    </ul>
  );
}

function TextAlternative({
  id,
  change,
  state,
  activeId,
}: {
  readonly id: string;
  readonly change: ResidueChange;
  readonly state: ViewerState;
  readonly activeId: string;
}) {
  const structure = state.phase === 'ready' ? state.structure : null;
  return (
    <div id={id} className="grid gap-2 border-t border-border pt-2 text-xs leading-relaxed">
      <p>
        <span className="font-medium">Residue change: </span>
        {describeChange(change)}.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Variant</dt>
        <dd>
          {change.variantLabel}
          {change.proteinHgvs !== null && <> · {change.proteinHgvs}</>}
          {change.legacyName !== null && <> · legacy {change.legacyName}</>}
        </dd>
        {change.summary !== null && (
          <>
            <dt className="text-muted-foreground">Summary</dt>
            <dd>{change.summary}</dd>
          </>
        )}
        {change.consequence !== null && (
          <>
            <dt className="text-muted-foreground">Consequence</dt>
            <dd>{change.consequence}</dd>
          </>
        )}
        {change.confidence !== null && (
          <>
            <dt className="text-muted-foreground">Confidence</dt>
            <dd>
              {change.confidence} · {change.provenance}
            </dd>
          </>
        )}
        {change.numberingNote !== null && (
          <>
            <dt className="text-muted-foreground">Numbering</dt>
            <dd>{change.numberingNote}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Structure</dt>
        <dd>
          PDB {activeId}
          {structure?.title ? <> — “{structure.title}” (as deposited)</> : null}
          {structure && (
            <>
              {' '}
              · {structure.chainCount} chains, {structure.atomCount.toLocaleString('en-GB')} atom records
            </>
          )}
        </dd>
      </dl>
      {structure && structure.highlightedChains.length === 0 && (
        <p role="status" className="rounded-md bg-verdict-escalate-soft p-2 text-foreground">
          No chain in PDB {activeId} carries the expected residue at position {change.pdbResidueNumber}
          {structure.otherChainsAtPosition.length > 0 &&
            ` (found ${structure.otherChainsAtPosition.map((o) => `${o.resName} in ${o.chainId}`).join(', ')})`}
          , so nothing is highlighted rather than marking an unrelated residue.
        </p>
      )}
      <p className="flex gap-2 rounded-md bg-muted p-2 text-foreground/80">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {change.limitation !== null && (
            <>
              <span className="font-medium">Limitation: </span>
              {change.limitation}{' '}
            </>
          )}
          {change.overridden &&
            'The position or residues were overridden by the host, so the curated annotation for this variant is not shown. '}
          The 3D view draws a deposited experimental structure and marks a sequence position on it. It is not a
          structure prediction and does not model the effect of the edit.
        </span>
      </p>
    </div>
  );
}
