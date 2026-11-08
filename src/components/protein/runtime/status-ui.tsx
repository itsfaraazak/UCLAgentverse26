import type { ReactNode } from 'react';
import { Cpu, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import type { FailureKind } from './errors';
import type { RendererKind } from './renderer';

// Presentational pieces shared by both 3D shells. three-free.

export interface RendererBadgeProps {
  readonly state:
    | { readonly phase: 'starting' }
    | { readonly phase: 'active'; readonly kind: RendererKind; readonly label: string; readonly fallbackReason: string | null }
    | { readonly phase: 'none' };
}

/** Pill showing which GPU path is live. */
export function RendererBadge({ state }: RendererBadgeProps) {
  let text: string;
  let title: string;
  let kind: string;
  if (state.phase === 'active') {
    text = state.label;
    kind = state.kind;
    title =
      `Rendered client-side on this device's GPU via ${state.label}.` +
      (state.fallbackReason ? ` WebGPU not used: ${state.fallbackReason}.` : '');
  } else if (state.phase === 'starting') {
    text = 'GPU…';
    kind = 'starting';
    title = 'Selecting a renderer (WebGPU if available, otherwise WebGL 2).';
  } else {
    text = 'No GPU';
    kind = 'none';
    title = 'No 3D renderer is active; showing the text view.';
  }
  return (
    <span
      data-renderer={kind}
      title={title}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 font-mono text-[10px] leading-none tracking-tight',
        'border-border text-muted-foreground',
        state.phase === 'active' &&
          state.kind === 'webgpu' &&
          'border-verdict-pass/50 text-verdict-pass',
      )}
    >
      <Cpu aria-hidden="true" className="size-3" />
      <span>{text}</span>
      <span className="sr-only">. {title}</span>
    </span>
  );
}

const FAILURE_TITLES: Record<FailureKind, string> = {
  library: 'The 3D library did not load',
  network: 'The structure could not be downloaded',
  data: 'The structure file could not be used',
  renderer: 'This device could not start WebGPU or WebGL 2',
  'context-lost': 'The GPU context was lost',
  unknown: 'The 3D view stopped unexpectedly',
};

export function failureTitle(kind: FailureKind): string {
  return FAILURE_TITLES[kind];
}

export interface FailurePanelProps {
  readonly kind: FailureKind;
  readonly detail: string;
  readonly onRetry: () => void;
  /** The text alternative that replaces the 3D view. */
  readonly children: ReactNode;
}

/** Shown in place of the canvas. Never a blank box. */
export function FailurePanel({ kind, detail, onRetry, children }: FailurePanelProps) {
  return (
    <div
      role="alert"
      data-failure={kind}
      className="absolute inset-0 flex flex-col gap-2 overflow-auto bg-card p-3 text-sm text-card-foreground"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-verdict-escalate" />
        <div className="min-w-0">
          <p className="font-medium">{failureTitle(kind)}</p>
          <p className="break-words text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
      <div className="min-w-0 text-xs leading-relaxed">{children}</div>
      <div className="mt-auto">
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          Retry
        </Button>
      </div>
    </div>
  );
}

export function LoadingOverlay({ label }: { readonly label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
        {label}
      </span>
    </div>
  );
}
