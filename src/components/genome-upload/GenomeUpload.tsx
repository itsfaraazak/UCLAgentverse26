'use client';

import {
  useCallback,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import {
  CircleCheck,
  FileUp,
  Info,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { getLocus, referenceSequence } from '@/lib/genome';
import { buildGenomeModel, type GenomeModel } from '@/components/genome-3d';
import { FastaParseError, UPLOAD_LIMITS, parseFasta } from './fasta';
import { needsAcknowledgement, screenUpload, type UploadScreening } from './screening';
import { validateSequence, type SequenceWarning, type ValidatedSequence } from './validate';

/**
 * "Bring your own genome" — paste a coding sequence or drop a FASTA file.
 *
 * The order of operations here is the point, and it is not negotiable
 * (SPEC §7.3/§7.4):
 *
 *   1. `screenUpload()` runs on the raw text **first**, before parsing,
 *      validating, diffing, translating or rendering anything.
 *   2. A `block` verdict ends it. The text is discarded, the category and the
 *      generic policy reason are shown, and nothing the user supplied is
 *      echoed back, stored or logged. `ScreenedUpload` has no `text` field on
 *      the refused branch, so there is nothing to render by mistake.
 *   3. An `escalate` verdict does not auto-approve. The sequence is held
 *      behind an explicit human acknowledgement (SPEC §7.5).
 *   4. Only then is the text parsed and validated.
 *
 * Uploaded data is session-only: this component never writes to
 * `localStorage`/`sessionStorage`, never issues a network request, and holds
 * the sequence in React state that dies with the page. The UI says so.
 *
 * The preloaded demo genome stays the default — upload is secondary, and
 * "Reset to demo genome" is always one click away.
 */

export interface GenomeUploadProps {
  /** Curated locus the upload is compared against. Default `HBB`. */
  readonly gene?: string;
  /**
   * Called with a model built from the curated reference vs the uploaded
   * sequence, or `null` when the user resets to the demo genome. Feed it
   * straight to `<GenomeHelix3D model={…} />`.
   */
  readonly onGenomeChange?: (model: GenomeModel | null) => void;
  /** Called with the accepted sequence, or `null` on reset. */
  readonly onSequenceChange?: (sequence: ValidatedSequence | null) => void;
  readonly className?: string;
}

type Problem =
  | { readonly kind: 'parse'; readonly message: string }
  | { readonly kind: 'sequence'; readonly message: string };

type UploadState =
  /** Demo genome is live. */
  | { readonly phase: 'idle' }
  | { readonly phase: 'working' }
  /** Refused by policy. Carries no uploaded text, by construction. */
  | { readonly phase: 'blocked'; readonly screening: UploadScreening }
  /**
   * Not a usable coding sequence. Deliberately carries no `screening`: these
   * are mechanical input failures, and inventing a policy verdict for them
   * would put a category in the UI that `screen()` never returned.
   */
  | { readonly phase: 'invalid'; readonly problem: Problem }
  /** Escalated: accepted by the gate, held for a human. */
  | {
      readonly phase: 'held';
      readonly screening: UploadScreening;
      readonly sequence: ValidatedSequence;
      readonly model: GenomeModel;
    }
  /** Live. */
  | {
      readonly phase: 'applied';
      readonly screening: UploadScreening;
      readonly sequence: ValidatedSequence;
    };

const ACCEPT = '.fasta,.fa,.fna,.ffn,.frn,.seq,.txt';

function formatInt(n: number): string {
  return n.toLocaleString('en-GB');
}

export function GenomeUpload({
  gene = 'HBB',
  onGenomeChange,
  onSequenceChange,
  className,
}: GenomeUploadProps) {
  const locus = getLocus(gene);
  const [text, setText] = useState('');
  const [state, setState] = useState<UploadState>({ phase: 'idle' });
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = { paste: useId(), status: useId(), note: useId() };

  const emit = useCallback(
    (model: GenomeModel | null, sequence: ValidatedSequence | null) => {
      onGenomeChange?.(model);
      onSequenceChange?.(sequence);
    },
    [onGenomeChange, onSequenceChange],
  );

  const reset = useCallback(() => {
    setText('');
    setState({ phase: 'idle' });
    if (fileInput.current !== null) fileInput.current.value = '';
    emit(null, null);
  }, [emit]);

  /**
   * The single entry point for anything the user supplies. Screening happens
   * on the first line, before the text is parsed or kept.
   */
  const submit = useCallback(
    (raw: string, fileName?: string) => {
      if (locus === undefined) {
        setState({
          phase: 'invalid',
          problem: {
            kind: 'parse',
            message: `There is no curated locus '${gene}' to compare an upload against.`,
          },
        });
        return;
      }

      // ---- 1. The gate, before anything else touches the input. ----------
      const screened = screenUpload({ text: raw, targetGene: locus.gene, fileName });

      if (!screened.accepted) {
        // Discard the input entirely: not stored, not echoed, not logged.
        setText('');
        if (fileInput.current !== null) fileInput.current.value = '';
        setState({ phase: 'blocked', screening: screened.screening });
        emit(null, null);
        return;
      }

      // ---- 2. Parse. -----------------------------------------------------
      let bases: string;
      let label: string;
      try {
        const parsed = parseFasta(screened.text, {
          fallbackLabel: fileName ?? 'Uploaded sequence',
        });
        bases = parsed.bases;
        label = parsed.label;
      } catch (err) {
        setState({
          phase: 'invalid',
          problem: {
            kind: 'parse',
            message:
              err instanceof FastaParseError
                ? err.message
                : 'That file could not be read as a sequence or a FASTA record.',
          },
        });
        emit(null, null);
        return;
      }

      // ---- 3. Validate against lib/genome's rules. -----------------------
      const reference = referenceSequence(locus);
      const result = validateSequence(bases, label, {
        referenceCodonCount: locus.cdsReference.codonCount,
      });
      if (!result.ok) {
        setState({
          phase: 'invalid',
          problem: { kind: 'sequence', message: result.error.message },
        });
        emit(null, null);
        return;
      }

      // ---- 4. Build the model the 3D view renders. -----------------------
      let model: GenomeModel;
      try {
        model = buildGenomeModel({
          ref: reference,
          alt: { bases: result.sequence.bases, label: result.sequence.label },
          locus,
        });
      } catch (err) {
        setState({
          phase: 'invalid',
          problem: {
            kind: 'sequence',
            message:
              err instanceof Error
                ? err.message
                : 'That sequence could not be compared with the reference allele.',
          },
        });
        emit(null, null);
        return;
      }

      // ---- 5. Escalation waits for a human (SPEC §7.5). ------------------
      if (needsAcknowledgement(screened.screening)) {
        setState({
          phase: 'held',
          screening: screened.screening,
          sequence: result.sequence,
          model,
        });
        emit(null, null);
        return;
      }

      setState({ phase: 'applied', screening: screened.screening, sequence: result.sequence });
      emit(model, result.sequence);
    },
    [emit, gene, locus],
  );

  const acknowledge = useCallback(() => {
    setState((current) => {
      if (current.phase !== 'held') return current;
      emit(current.model, current.sequence);
      return {
        phase: 'applied',
        screening: current.screening,
        sequence: current.sequence,
      };
    });
  }, [emit]);

  const readFile = useCallback(
    (file: File) => {
      if (file.size > UPLOAD_LIMITS.maxRawChars) {
        // Refuse on size before reading, so an enormous file is never loaded.
        setState({
          phase: 'invalid',
          problem: {
            kind: 'parse',
            message: `That file is ${formatInt(file.size)} bytes, over the ${formatInt(UPLOAD_LIMITS.maxRawChars)} byte limit, so it was not opened.`,
          },
        });
        return;
      }
      setState({ phase: 'working' });
      void file
        .text()
        .then((contents) => submit(contents, file.name))
        .catch(() => {
          setState({
            phase: 'invalid',
            problem: { kind: 'parse', message: 'That file could not be read.' },
          });
        });
    },
    [submit],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) readFile(file);
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file !== undefined) readFile(file);
  };

  const live = state.phase === 'applied';

  return (
    <section
      data-slot="genome-upload"
      className={cn('flex w-full min-w-0 flex-col text-card-foreground', className)}
    >
      <header className="flex min-w-0 items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            <Upload aria-hidden="true" className="size-3" />
            Genome source
          </p>
          <h2 className="font-display mt-1 text-[0.9375rem] leading-tight tracking-[-0.02em]">
            {live ? 'Uploaded sequence' : 'Demo genome'}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {live ? (
              <>
                Comparing against <span className="seq">{gene}</span>{' '}
                {locus?.cdsReference.label ?? 'reference allele'}
              </>
            ) : (
              <>
                Preloaded <span className="seq">{gene}</span> ·{' '}
                {locus?.cdsReference.codonCount ?? 0} codons. Upload is optional.
              </>
            )}
          </p>
        </div>
        {live && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reset}
            className="h-7 shrink-0 gap-1.5 px-2 text-xs"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            Reset to demo
          </Button>
        )}
      </header>

      {/* Drop target + file picker. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-md border border-dashed px-3 py-4 text-center transition-colors hairline',
          dragging ? 'border-ring' : 'border-border',
        )}
        style={
          dragging
            ? { background: 'color-mix(in oklab, var(--ring) 8%, transparent)' }
            : undefined
        }
      >
        <FileUp aria-hidden="true" className="mx-auto size-4 text-muted-foreground" />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Drop a FASTA file, or{' '}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="rounded-sm font-medium text-foreground underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            choose a file
          </button>
        </p>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          onChange={onPick}
          className="sr-only"
          aria-label="Choose a FASTA file"
        />
      </div>

      {/* Paste. */}
      <div className="mt-3">
        <label
          htmlFor={ids.paste}
          className="text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-muted-foreground"
        >
          Or paste a coding sequence
        </label>
        <textarea
          id={ids.paste}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          placeholder="ATGGTGCATCTGACTCCTGAGGAG…  or  >HBB  (newline)  ATGGTG…"
          aria-describedby={ids.note}
          className="seq mt-1.5 w-full resize-y rounded-md border border-border bg-transparent px-2.5 py-2 text-xs leading-relaxed outline-none placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring hairline"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={text.trim() === '' || state.phase === 'working'}
            onClick={() => submit(text)}
            className="h-7 gap-1.5 px-2.5 text-xs"
          >
            <ShieldCheck aria-hidden="true" className="size-3.5" />
            Screen and load
          </Button>
          {!live && (text.trim() !== '' || state.phase !== 'idle') && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reset}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              Reset to demo genome
            </Button>
          )}
        </div>
        <p id={ids.note} className="mt-2 text-[0.6875rem] leading-relaxed text-muted-foreground">
          Up to {formatInt(UPLOAD_LIMITS.maxBases)} bases ({formatInt(UPLOAD_LIMITS.maxBases / 3)}{' '}
          codons), {formatInt(UPLOAD_LIMITS.maxRawChars)} characters of raw input. A/C/G/T only,
          in frame, a whole number of codons. Every upload is screened before it is read.
        </p>
      </div>

      <div id={ids.status} role="status" aria-live="polite" className="mt-3 empty:mt-0">
        {state.phase === 'blocked' && <BlockedPanel screening={state.screening} />}
        {state.phase === 'invalid' && (
          <Notice tone="block" icon={<TriangleAlert aria-hidden="true" className="size-3.5" />} title="That sequence cannot be used">
            <p>{state.problem.message}</p>
          </Notice>
        )}
        {state.phase === 'held' && (
          <Notice
            tone="escalate"
            icon={<ShieldQuestion aria-hidden="true" className="size-3.5" />}
            title={`Held for review · ${state.screening.category}`}
          >
            <p>{state.screening.reason}</p>
            {state.screening.signoffRole !== null && (
              <p className="mt-1">
                Sign-off required from{' '}
                <span className="font-medium text-foreground">
                  {state.screening.signoffRole.replace(/_/g, ' ')}
                </span>
                . Nothing is applied automatically.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={acknowledge}
              className="mt-2 h-7 gap-1.5 px-2 text-xs"
            >
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              Acknowledge and load anyway
            </Button>
          </Notice>
        )}
        {state.phase === 'applied' && (
          <Notice
            tone="pass"
            icon={<CircleCheck aria-hidden="true" className="size-3.5" />}
            title={`Loaded · ${state.screening.category}`}
          >
            <p>
              <span className="seq">{state.sequence.label}</span> ·{' '}
              <span className="seq">{formatInt(state.sequence.codonCount)}</span> codons.
            </p>
            {state.sequence.warnings.length > 0 && (
              <Warnings warnings={state.sequence.warnings} />
            )}
          </Notice>
        )}
      </div>

      <p className="mt-3 flex gap-2 border-t border-border pt-3 text-[0.6875rem] leading-relaxed text-muted-foreground hairline">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Session only. An uploaded sequence stays in this tab&rsquo;s memory, is never
          written to storage and is never sent anywhere — reloading the page returns to the
          demo genome. Screening is a deterministic keyword-and-registry check, not a
          substitute for institutional biosafety review.
        </span>
      </p>
    </section>
  );
}

/**
 * A refused upload. Renders the policy category and the generic reason, and
 * nothing else — `screening` is the only thing in scope here, and it carries
 * no user text by construction (SPEC §7.3).
 */
function BlockedPanel({ screening }: { readonly screening: UploadScreening }) {
  return (
    <Notice
      tone="block"
      icon={<ShieldAlert aria-hidden="true" className="size-3.5" />}
      title={`Refused · ${screening.category}`}
    >
      <p>{screening.reason}</p>
      {screening.flaggedGenes.length > 0 && (
        <p className="mt-1">
          Flagged target{screening.flaggedGenes.length > 1 ? 's' : ''}:{' '}
          <span className="seq">{screening.flaggedGenes.join(', ')}</span>
        </p>
      )}
      <p className="mt-1">
        The text you submitted was discarded — not stored, not logged and not shown back.
        {screening.requestDigest !== '' && (
          <>
            {' '}
            The audit trail references it only by digest{' '}
            <span className="seq">{screening.requestDigest}</span>.
          </>
        )}
      </p>
    </Notice>
  );
}

function Warnings({ warnings }: { readonly warnings: readonly SequenceWarning[] }) {
  return (
    <ul className="mt-1.5 grid gap-1">
      {warnings.map((w) => (
        <li key={w.code} className="flex gap-1.5">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-3 shrink-0"
            style={{ color: 'var(--verdict-escalate)' }}
          />
          <span>{w.message}</span>
        </li>
      ))}
    </ul>
  );
}

const TONE = {
  pass: { token: 'var(--verdict-pass)', label: 'Passed' },
  escalate: { token: 'var(--verdict-escalate)', label: 'Needs review' },
  block: { token: 'var(--verdict-block)', label: 'Refused' },
} as const;

/**
 * Verdict surface. Colour is never the only signal: every notice carries an
 * icon and a text label as well (SPEC §5, accessibility).
 */
function Notice({
  tone,
  icon,
  title,
  children,
}: {
  readonly tone: keyof typeof TONE;
  readonly icon: ReactNode;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const { token, label } = TONE[tone];
  return (
    <div
      className="rounded-md px-2.5 py-2 text-xs leading-relaxed"
      style={{
        background: `color-mix(in oklab, ${token} 10%, transparent)`,
        boxShadow: `inset 0 0 0 0.5px color-mix(in oklab, ${token} 35%, transparent)`,
      }}
    >
      <p className="flex items-center gap-1.5 font-medium" style={{ color: token }}>
        {icon}
        <span className="text-foreground">{title}</span>
        <span className="sr-only">({label})</span>
      </p>
      <div className="mt-1 text-muted-foreground">{children}</div>
    </div>
  );
}
