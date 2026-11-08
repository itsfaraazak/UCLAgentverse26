import Link from 'next/link';
import { ArrowUpRight, GitBranch, ShieldAlert, Microscope, Network, Columns3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { VARIANTS } from './variants';
import { getLocus } from '@/lib/genome';

/**
 * The landing page: one product, three surfaces.
 *
 * Deliberately thin — it carries no workspace state of its own. The numbers it
 * does show (the modelled region's length, the codon under edit) come from the
 * same `loci.json` fixture the variants read, so this page cannot drift from
 * them.
 */

const ICONS: Readonly<Record<string, LucideIcon>> = {
  '/ide': Columns3,
  '/bench': Microscope,
  '/graph': Network,
};

export default function Home() {
  const locus = getLocus('HBB');
  const cds = locus?.cdsReference ?? null;
  const codonCount = cds?.codonCount ?? null;
  const sickle = locus?.variants.find((v) => v.id === 'HBB_HbS') ?? null;

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-6 py-20 sm:px-10">
        <header className="flex flex-col gap-6">
          <p className="seq text-xs text-muted-foreground">SigmaFold · UCL AgentVerse 2026</p>
          <h1 className="font-display max-w-2xl text-5xl leading-[1.05] sm:text-6xl">
            Version control for genetic engineering.
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Open a branch, apply an edit to a genotype, and a seven-agent CI pipeline decides
            whether it passes — structurally, functionally, and on biosafety grounds — before it
            can be merged. Content-addressed objects, three-way merge, and a check-run gate on
            the merge.
          </p>
          <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">Locus</dt>
              <dd className="seq">{locus?.gene ?? 'HBB'}</dd>
            </div>
            {codonCount !== null && (
              <div className="flex items-baseline gap-2">
                <dt className="text-muted-foreground">Modelled region</dt>
                <dd className="seq">
                  {codonCount} codons / {cds?.bases.length ?? codonCount * 3} nt
                </dd>
              </div>
            )}
            {sickle !== null && (
              <div className="flex items-baseline gap-2">
                <dt className="text-muted-foreground">Worked example</dt>
                <dd className="seq">
                  codon {sickle.codonIndex} {sickle.refCodon}→{sickle.altCodon}
                </dd>
              </div>
            )}
          </dl>
        </header>

        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-2xl">Three surfaces, one core</h2>
            <p className="text-sm text-muted-foreground">
              The same <code className="seq text-[0.95em]">lib/</code> modules behind every one —
              the same repository, the same diff engine, the same pipeline and the same gate. Only
              what each surface makes primary differs.
            </p>
          </div>

          <ul className="grid gap-4 sm:grid-cols-3">
            {VARIANTS.map((variant) => {
              const Icon = ICONS[variant.href] ?? GitBranch;
              return (
                <li key={variant.href} className="flex">
                  <Link
                    href={variant.href}
                    className="group flex flex-1 flex-col gap-3 rounded-xl border bg-card p-5 transition-colors hover:border-ring/60 hover:bg-accent/40"
                  >
                    <span className="flex items-center justify-between">
                      <Icon aria-hidden className="size-5 text-primary" />
                      <ArrowUpRight
                        aria-hidden
                        className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                      />
                    </span>
                    <span className="flex flex-col gap-1">
                      <span className="font-medium">{variant.name}</span>
                      <span className="seq text-[0.7rem] text-muted-foreground">
                        {variant.href}
                      </span>
                    </span>
                    <span className="text-sm leading-relaxed text-muted-foreground">
                      {variant.concept}
                    </span>
                    <span className="mt-auto text-xs text-muted-foreground/80 italic">
                      Feels like: {variant.feel}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-verdict-escalate/40 bg-verdict-escalate/5 p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <ShieldAlert aria-hidden className="size-4 text-verdict-escalate" />
            What this prototype is, and what it is not
          </h2>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>
              The capillary-flow simulation is <strong>illustrative and uncalibrated</strong> — a
              deterministic particle model, not validated hemorheology. Its numbers are real
              outputs of that model and nothing more.
            </li>
            <li>
              Structural annotations are <strong>curated summaries</strong> from a fixture file,
              not predictions. Nothing here infers the consequence of an edit.
            </li>
            <li>
              The biosafety screen is a <strong>lexical</strong> policy check. It over-blocks, and
              it is evadable by rephrasing. It demonstrates where a gate belongs in the pipeline;
              it is not a real screening system.
            </li>
            <li>
              No construct designs, protocols or wet-lab parameters — by design. The fixture is a
              short public reference region used for diffing and translation only.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
