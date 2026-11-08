'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Crosshair,
  Dna,
  Info,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Scan,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import {
  classifyFailure,
  describe as describeError,
  isAbort,
  type FailureKind,
} from '@/components/protein/runtime/errors';
import { usePrefersReducedMotion } from '@/components/protein/runtime/motion';
import type { RendererPreference } from '@/components/protein/runtime/renderer';
import {
  FailurePanel,
  LoadingOverlay,
  RendererBadge,
} from '@/components/protein/runtime/status-ui';
import { loadGenomeEngine } from './load-engine';
import { GENOME_PALETTE } from './palette';
import type { GenomeEngineHandle, RendererInfo, SceneSummary } from './engine';
import {
  buildLocusModel,
  describeEdit,
  structuralSummary,
  type GenomeModel,
} from './model';

/**
 * 3D view of the locus under edit — the gene itself, as a schematic B-form
 * double helix with one bead per codon and the edited codon marked.
 *
 * Props-driven and layout-agnostic: it fills whatever box it is given, down
 * to roughly 320px wide, and assumes nothing about the surrounding page. It
 * is a `'use client'` component that is safe to render from a server
 * component — the full text alternative prerenders, and `three` arrives only
 * via a dynamic `import()` after mount, so no `next/dynamic` is needed.
 */

export interface GenomeHelix3DProps {
  /** Gene symbol in `loci.json`. Default `HBB`. Ignored when `model` is set. */
  readonly gene?: string;
  /** Variant id, e.g. `HBB_HbS`. Ignored when `model` is set. */
  readonly variantId?: string;
  /**
   * A prebuilt model, for sequences that are not curated fixtures — this is
   * how `components/genome-upload` shows an uploaded genome.
   */
  readonly model?: GenomeModel;
  /** `'webgl'` forces the WebGL 2 path, e.g. to rehearse the fallback. */
  readonly renderer?: RendererPreference;
  /** Idle rotation. Forced off under `prefers-reduced-motion`. */
  readonly autoRotate?: boolean;
  /** Notified when the active renderer changes (`null` when none is live). */
  readonly onRendererChange?: (info: RendererInfo | null) => void;
  readonly className?: string;
}

type ViewState =
  | { readonly phase: 'loading'; readonly step: 'library' | 'gpu' }
  | { readonly phase: 'ready'; readonly renderer: RendererInfo; readonly scene: SceneSummary }
  | { readonly phase: 'error'; readonly kind: FailureKind; readonly detail: string };

const LOADING_LABEL = {
  library: 'Loading 3D library…',
  gpu: 'Starting GPU renderer…',
} as const;

const ORBIT_STEP = 0.2;
const ZOOM_STEP = 1.25;

/** `#rrggbb` for an inline swatch, from the engine's own palette. */
function hex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

export function GenomeHelix3D({
  gene,
  variantId,
  model: providedModel,
  renderer: prefer = 'auto',
  autoRotate = false,
  onRendererChange,
  className,
}: GenomeHelix3DProps) {
  // Building the model can throw (unknown locus, malformed sequence). Resolve
  // it to a value-or-error so a bad prop renders the text fallback instead of
  // taking the host page down with it.
  const resolved = useMemo<
    { readonly ok: true; readonly model: GenomeModel } | { readonly ok: false; readonly detail: string }
  >(() => {
    if (providedModel !== undefined) return { ok: true, model: providedModel };
    try {
      return { ok: true, model: buildLocusModel({ gene, variantId }) };
    } catch (err) {
      return { ok: false, detail: describeError(err) };
    }
  }, [providedModel, gene, variantId]);

  const reducedMotion = usePrefersReducedMotion();
  const [spinRequested, setSpinRequested] = useState(autoRotate);
  const spinning = spinRequested && !reducedMotion;

  const [attempt, setAttempt] = useState(0);
  const model = resolved.ok ? resolved.model : null;

  // State is tagged with the request it belongs to, so a new model or a retry
  // reads as "loading" without a synchronous reset.
  const requestKey = `${model?.gene ?? 'none'}|${model?.refLabel ?? ''}|${model?.altLabel ?? ''}|${model?.totalCodonCount ?? 0}|${prefer}|${attempt}`;
  const [tagged, setTagged] = useState<{ key: string; state: ViewState } | null>(null);
  const state: ViewState = !resolved.ok
    ? { phase: 'error', kind: 'data', detail: resolved.detail }
    : tagged !== null && tagged.key === requestKey
      ? tagged.state
      : { phase: 'loading', step: 'library' };

  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<GenomeEngineHandle | null>(null);
  // Read through a ref inside the mount effect so toggling rotation never
  // remounts the GPU scene; the effect below pushes it to the live handle.
  const spinningRef = useRef(spinning);
  const rendererCb = useRef(onRendererChange);
  useEffect(() => {
    rendererCb.current = onRendererChange;
  }, [onRendererChange]);

  const ids = { title: useId(), alt: useId() };

  useEffect(() => {
    const container = hostRef.current;
    if (container === null || model === null) return;
    const controller = new AbortController();
    const { signal } = controller;
    let handle: GenomeEngineHandle | null = null;
    const setState = (next: ViewState): void => setTagged({ key: requestKey, state: next });

    const fail = (err: unknown): void => {
      if (signal.aborted || isAbort(err)) return;
      handle?.dispose();
      handle = null;
      handleRef.current = null;
      rendererCb.current?.(null);
      setState({ phase: 'error', kind: classifyFailure(err), detail: describeError(err) });
    };

    void (async () => {
      try {
        const engine = await loadGenomeEngine();
        if (signal.aborted) return;
        setState({ phase: 'loading', step: 'gpu' });
        const mounted = await engine.mountGenomeEngine({
          container,
          model,
          prefer,
          autoRotate: spinningRef.current,
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
        setState({ phase: 'ready', renderer: mounted.renderer, scene: mounted.scene });
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
  }, [model, prefer, requestKey]);

  // Keep the latest spin preference available to a mount in flight.
  useEffect(() => {
    spinningRef.current = spinning;
    handleRef.current?.setAutoRotate(spinning);
  }, [spinning]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const ready = state.phase === 'ready';
  const hasEdit = model !== null && model.primaryEditedCodon !== null;

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
      f: () => void handle.focusEdit(),
      F: () => void handle.focusEdit(),
    };
    const action = actions[event.key];
    if (action === undefined) return;
    event.preventDefault();
    action();
  };

  const editLabel = model === null ? '' : describeEdit(model);
  const codonLabel =
    model === null || model.primaryEditedCodon === null
      ? 'the edit site'
      : `${model.coordinatesDiverge ? 'alignment row' : 'codon'} ${model.primaryEditedCodon}`;

  const viewLabel =
    model === null
      ? 'Genome view unavailable.'
      : `Schematic 3D double helix of ${model.gene}, ${model.totalCodonCount} codons. ${editLabel}. ` +
        'The edited codon is marked with a ring and a brighter bead. ' +
        'Arrow keys rotate, plus and minus zoom, 0 resets, F jumps to the edit site.';

  return (
    <section
      aria-labelledby={ids.title}
      data-slot="genome-helix-3d"
      className={cn('@container flex w-full min-w-0 flex-col text-card-foreground', className)}
    >
      <header className="flex min-w-0 items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.04em] text-muted-foreground">
            <Dna aria-hidden="true" className="size-3" />
            Locus · 3D
          </p>
          <h2
            id={ids.title}
            className="font-display mt-1 truncate text-[0.9375rem] leading-tight tracking-[-0.02em]"
          >
            {model === null ? 'Genome view' : `${model.gene} coding region`}
          </h2>
          {model !== null && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {model.locusName ?? model.refLabel} ·{' '}
              <span className="seq">{model.modelledCodonCount}</span> of{' '}
              <span className="seq">{model.totalCodonCount}</span> codons sequenced
            </p>
          )}
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

      <div
        className="relative aspect-[4/3] min-h-[200px] w-full overflow-hidden rounded-md"
        style={{ background: 'color-mix(in oklab, var(--foreground) 4%, transparent)' }}
      >
        <div
          ref={hostRef}
          role="img"
          aria-label={viewLabel}
          aria-describedby={ids.alt}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + - 0 F"
          tabIndex={ready ? 0 : -1}
          onKeyDown={onKeyDown}
          className="absolute inset-0 cursor-grab rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:cursor-grabbing"
        />
        {state.phase === 'loading' && <LoadingOverlay label={LOADING_LABEL[state.step]} />}
        {state.phase === 'error' && (
          <FailurePanel kind={state.kind} detail={state.detail} onRetry={retry}>
            {model === null ? (
              <p>The locus could not be resolved, so there is nothing to describe.</p>
            ) : (
              <>
                <p>
                  <span className="font-medium">Codon change: </span>
                  {editLabel}.
                </p>
                <p className="mt-1">{structuralSummary(model)}</p>
                <p className="mt-1 text-muted-foreground">
                  The full description is below the view.
                </p>
              </>
            )}
          </FailurePanel>
        )}
      </div>

      <div
        role="toolbar"
        aria-label="Genome view controls"
        className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
      >
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!ready}
            aria-label="Rotate left"
            title="Rotate left (←)"
            onClick={() => handleRef.current?.orbit(-ORBIT_STEP, 0)}
          >
            <RotateCcw aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!ready}
            aria-label="Rotate right"
            title="Rotate right (→)"
            onClick={() => handleRef.current?.orbit(ORBIT_STEP, 0)}
          >
            <RotateCw aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!ready}
            aria-label="Zoom in"
            title="Zoom in (+)"
            onClick={() => handleRef.current?.zoom(ZOOM_STEP)}
          >
            <ZoomIn aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!ready}
            aria-label="Zoom out"
            title="Zoom out (−)"
            onClick={() => handleRef.current?.zoom(1 / ZOOM_STEP)}
          >
            <ZoomOut aria-hidden="true" />
          </Button>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!ready || !hasEdit}
            title="Jump to the edited codon (F)"
            onClick={() => handleRef.current?.focusEdit()}
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <Crosshair aria-hidden="true" className="size-3.5" />
            Edit site
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!ready}
            title="Frame the whole locus (0)"
            onClick={() => handleRef.current?.resetView()}
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <Scan aria-hidden="true" className="size-3.5" />
            Fit
          </Button>
          {!reducedMotion && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={!ready}
              aria-label={spinning ? 'Stop rotating' : 'Rotate automatically'}
              aria-pressed={spinning}
              title={spinning ? 'Stop rotating' : 'Rotate automatically'}
              onClick={() => setSpinRequested((on) => !on)}
            >
              {spinning ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </Button>
          )}
        </div>
      </div>

      {model !== null && (
        <>
          <Legend model={model} codonLabel={codonLabel} />
          <TextAlternative id={ids.alt} model={model} state={state} />
        </>
      )}
    </section>
  );
}

function Swatch({ color }: { readonly color: number }) {
  return (
    <span
      aria-hidden="true"
      className="mt-[0.3rem] size-2 shrink-0 rounded-[2px]"
      style={{ background: hex(color) }}
    />
  );
}

function Legend({
  model,
  codonLabel,
}: {
  readonly model: GenomeModel;
  readonly codonLabel: string;
}) {
  const hasSilent = model.segments.some((s) => s.silent);
  const hasUnsequenced = model.totalCodonCount > model.modelledCodonCount;
  return (
    <ul
      aria-label="Legend"
      className="mt-3 grid gap-1.5 border-t-[0.5px] border-border/85 pt-3 text-xs text-muted-foreground"
    >
      {model.primaryEditedCodon !== null && (
        <li className="flex gap-2">
          <Swatch color={GENOME_PALETTE.codonEdited} />
          <span className="text-foreground">
            Edited codon — {codonLabel}, ringed and enlarged
          </span>
        </li>
      )}
      <li className="flex gap-2">
        <Swatch color={GENOME_PALETTE.codonSame} />
        <span>Unchanged codon, with sequence</span>
      </li>
      {hasSilent && (
        <li className="flex gap-2">
          <Swatch color={GENOME_PALETTE.codonSilent} />
          <span>Silent change — codon differs, amino acid does not</span>
        </li>
      )}
      {hasUnsequenced && (
        <li className="flex gap-2">
          <Swatch color={GENOME_PALETTE.codonUnsequenced} />
          <span>
            Annotated but not sequenced here — drawn dim, with no base pairs, because this
            prototype holds no bases for it
          </span>
        </li>
      )}
    </ul>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <>
      <dt className="mt-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.04em] text-muted-foreground first:mt-0 @sm:mt-0">
        {label}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function TextAlternative({
  id,
  model,
  state,
}: {
  readonly id: string;
  readonly model: GenomeModel;
  readonly state: ViewState;
}) {
  const scene = state.phase === 'ready' ? state.scene : null;
  const annotation = model.annotation;
  const edited = model.segments.find((s) => s.codonIndex === model.primaryEditedCodon);
  const positionWord = model.coordinatesDiverge ? 'alignment row' : 'codon';

  return (
    <div
      id={id}
      className="mt-3 grid gap-3 border-t-[0.5px] border-border/85 pt-3 text-xs leading-relaxed"
    >
      <p>
        <span className="font-medium">Codon change: </span>
        {describeEdit(model)}.
      </p>
      <dl className="grid grid-cols-1 items-baseline @sm:grid-cols-[max-content_minmax(0,1fr)] @sm:gap-x-4 @sm:gap-y-1.5">
        {edited !== undefined && edited.refCodon !== null && edited.altCodon !== null && (
          <Row label={positionWord}>
            <span className="seq">{edited.refCodon}</span> →{' '}
            <span className="seq">{edited.altCodon}</span> at {positionWord}{' '}
            {edited.codonIndex}
            {edited.refAa !== null && edited.altAa !== null && (
              <>
                {' '}
                · <span className="seq">{edited.refAa}</span> →{' '}
                <span className="seq">{edited.altAa}</span>
              </>
            )}
          </Row>
        )}
        <Row label="Sequences">
          {model.refLabel} vs {model.altLabel}
        </Row>
        <Row label="Protein">
          <span className="seq break-all">{model.refProtein}</span>
          {model.altProtein !== model.refProtein && (
            <>
              {' → '}
              <span className="seq break-all">{model.altProtein}</span>
            </>
          )}
        </Row>
        {annotation !== null && (
          <>
            <Row label="Variant">
              {annotation.variantLabel}
              {annotation.proteinHgvs !== null && <> · {annotation.proteinHgvs}</>}
              {annotation.legacyName !== null && <> · legacy {annotation.legacyName}</>}
            </Row>
            {annotation.structural !== null && (
              <Row label="Consequence">{annotation.structural.consequence}</Row>
            )}
            {annotation.structural !== null && (
              <Row label="Confidence">
                {annotation.structural.confidence} · {annotation.provenance}
              </Row>
            )}
            {annotation.numberingNote !== null && (
              <Row label="Numbering">{annotation.numberingNote}</Row>
            )}
          </>
        )}
        {scene !== null && (
          <Row label="Drawn">
            {scene.codonInstances} codon beads ({scene.modelledCodons} sequenced,{' '}
            {scene.unsequencedCodons} annotated only) and {scene.rungInstances} base pairs,
            instanced
          </Row>
        )}
      </dl>

      {model.coordinatesDiverge && (
        <p
          role="status"
          className="flex gap-2 rounded-md px-2.5 py-2 text-[0.6875rem]"
          style={{
            background: 'color-mix(in oklab, var(--verdict-escalate) 10%, transparent)',
          }}
        >
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
            style={{ color: 'var(--verdict-escalate)' }}
          />
          <span>
            This diff contains an inserted or deleted codon, so positions after it are
            alignment rows rather than CDS codon numbers. The two sequences no longer share
            one coordinate system (SPEC §4.5 #2).
          </span>
        </p>
      )}

      <p className="flex gap-2 text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {model.limitation !== null && (
            <>
              <span className="font-medium text-foreground">Limitation: </span>
              {model.limitation}{' '}
            </>
          )}
          The helix is a schematic drawn at textbook B-form proportions to place the codons
          in space. It is not a predicted or deposited structure, and nothing here models
          the physical effect of the edit.
        </span>
      </p>
    </div>
  );
}
