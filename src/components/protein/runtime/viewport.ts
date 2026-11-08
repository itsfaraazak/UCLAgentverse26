import { ContextLostError } from './errors';
import type { RenderSurface } from './renderer';

/**
 * Attach a renderer's canvas to a host element and keep it sized to that
 * element. Returns a detach function that removes every listener/observer it
 * installed and takes the canvas back out of the DOM.
 *
 * Sizing follows the *container*, not the window, so the components work in
 * a narrow side panel as well as full-bleed.
 */
export interface ViewportOptions {
  readonly container: HTMLElement;
  readonly surface: RenderSurface;
  readonly onResize: (width: number, height: number) => void;
  readonly onContextLost: (err: ContextLostError) => void;
  /** Upper bound on devicePixelRatio; 2 keeps retina sharp without 3× fill cost. */
  readonly maxPixelRatio?: number;
}

const MIN_SIZE = 1;

export function attachViewport(options: ViewportOptions): () => void {
  const { container, surface, onResize, onContextLost, maxPixelRatio = 2 } = options;
  const canvas = surface.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  // The canvas is presentational; the host element carries role="img" and the
  // text alternative. Hiding the canvas avoids an unlabelled graphic node.
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  surface.setPixelRatio(Math.min(dpr, maxPixelRatio));

  const resize = (): void => {
    const width = Math.max(MIN_SIZE, Math.floor(container.clientWidth));
    const height = Math.max(MIN_SIZE, Math.floor(container.clientHeight));
    surface.setSize(width, height, false);
    onResize(width, height);
  };
  resize();

  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(resize);
    observer.observe(container);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', resize);
  }

  const lost = (event: Event): void => {
    event.preventDefault();
    onContextLost(new ContextLostError());
  };
  canvas.addEventListener('webglcontextlost', lost);

  return () => {
    observer?.disconnect();
    if (observer === null && typeof window !== 'undefined') {
      window.removeEventListener('resize', resize);
    }
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.remove();
  };
}
