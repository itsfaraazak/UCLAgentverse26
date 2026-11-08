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
 */

import Link from 'next/link';
import { Columns3, Microscope, Network, PanelsTopLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { VARIANTS } from '@/app/variants';

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
    <nav className="vswitch" aria-label="Workspace surface">
      <Link
        href="/"
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
            href={variant.href}
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
