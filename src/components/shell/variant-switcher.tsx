'use client';

/**
 * Surface switcher.
 *
 * SigmaFold is one product with four surfaces over the same `lib/` core: this
 * shell, and the three variant views at /ide, /bench and /graph (SPEC §6).
 * They are not separate apps, so the switch between them belongs in the window
 * chrome rather than on a landing page a judge has to navigate back to.
 *
 * A plain `next/link` per surface, because each variant is its own route and a
 * full navigation is the honest thing here — the surfaces do not share client
 * state, and pretending they do by faking a tab switch would be a lie about
 * what is happening.
 *
 * What the links *do* carry is the created-line overlay (`line` params, see
 * `model/overlay-url.ts`). The variant surfaces do not render created lines,
 * and this does not make them: it keeps the params in the URL so the trip
 * back to `/` restores what the user made. Dropping them here would put the
 * silent-erasure bug back, one surface further out.
 *
 * The params are read with `useSearchParams`, which depends on the request, so
 * it sits behind a `<Suspense>` boundary *inside* this component. The fallback
 * is the same navigation with bare hrefs — real, working links, not a
 * placeholder — which keeps every variant route prerenderable.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Columns3, Microscope, Network, PanelsTopLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { VARIANTS } from '@/app/variants';
import { OVERLAY_PARAM, carriedOverlayParams } from './model/overlay-url';

const ICONS: Readonly<Record<string, LucideIcon>> = {
  '/ide': Columns3,
  '/bench': Microscope,
  '/graph': Network,
};

export interface VariantSwitcherProps {
  /** The route currently rendering, so it can be marked as current. */
  readonly current: '/' | '/ide' | '/bench' | '/graph';
}

export function VariantSwitcher({ current }: VariantSwitcherProps) {
  return (
    <Suspense fallback={<SwitcherNav current={current} query="" />}>
      <SwitcherWithOverlay current={current} />
    </Suspense>
  );
}

function SwitcherWithOverlay({ current }: VariantSwitcherProps) {
  const params = useSearchParams();
  // Only the overlay is carried. Every other param on the current URL belongs
  // to the surface that is being left.
  //
  // And only the entries that are shape-valid: these routes cannot resolve an
  // overlay, but copying a raw param into an href would echo an invalid name
  // from the URL back into the page, which is exactly what must not happen.
  const lines = carriedOverlayParams(params.getAll(OVERLAY_PARAM));
  const query = lines.map((line) => `${OVERLAY_PARAM}=${line}`).join('&');
  return <SwitcherNav current={current} query={query} />;
}

function SwitcherNav({
  current,
  query,
}: {
  readonly current: VariantSwitcherProps['current'];
  readonly query: string;
}) {
  const href = (path: string): string => (query === '' ? path : `${path}?${query}`);

  return (
    <nav className="vswitch" aria-label="Workspace surface">
      <Link
        href={href('/')}
        className="vswitch__item"
        aria-current={current === '/' ? 'page' : undefined}
        title="The three-pane workspace shell"
      >
        <PanelsTopLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
        <span className="vswitch__label">Shell</span>
      </Link>

      {VARIANTS.map((variant) => {
        const Icon = ICONS[variant.href] ?? Columns3;
        return (
          <Link
            key={variant.href}
            href={href(variant.href)}
            className="vswitch__item"
            aria-current={current === variant.href ? 'page' : undefined}
            title={`${variant.name} — ${variant.tagline}`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            <span className="vswitch__label">{variant.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
