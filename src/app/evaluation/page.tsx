/**
 * Judge-facing view of the offline benchmark. Static: every number is read
 * from `src/data/eval/results.json`, which `pnpm eval` regenerates.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Logo } from '@/components/brand/Logo';
import rawResults from '@/data/eval/results.json';
import type { EvalResults, MethodResult, VariantRow } from '@/lib/eval/benchmark';
import { af, ci, frac, pct, score } from '@/lib/eval/format';
import { CALLS, TRUTHS, type MethodMetrics, type Rate } from '@/lib/eval/metrics';

import './evaluation.css';

const results = rawResults as unknown as EvalResults;

export const metadata: Metadata = {
  title: 'Evaluation | SigmaFold',
  description: 'SigmaFold\'s ACMG classifier and single-signal baselines scored against ClinVar expert consensus on real public variants.',
};

const CLASSES = ['Pathogenic', 'Likely Pathogenic', 'Uncertain Significance', 'Likely Benign', 'Benign'] as const;
const SHORT: Readonly<Record<string, string>> = {
  Pathogenic: 'P',
  'Likely Pathogenic': 'LP',
  'Uncertain Significance': 'VUS',
  'Likely Benign': 'LB',
  Benign: 'B',
};

function RateCell({ r, strong }: { readonly r: Rate; readonly strong?: boolean }) {
  if (r.n === 0) return <td className="ev-num ev-muted">n/a</td>;
  return (
    <td className="ev-num">
      <span className={strong ? 'ev-strong' : undefined}>{pct(r.value)}</span>
      <span className="ev-sub">
        {r.k}/{r.n}
        {r.ci95 && ` · ${ci(r)}`}
      </span>
    </td>
  );
}

function CountCell({ r, danger }: { readonly r: Rate; readonly danger?: boolean }) {
  return (
    <td className={r.k > 0 && danger ? 'ev-num ev-danger' : 'ev-num'}>
      <span className="ev-strong">{r.k}</span>
      <span className="ev-sub">of {r.n} ({pct(r.value)})</span>
    </td>
  );
}

function MetricsTable({ rows, caption }: { readonly rows: readonly { name: string; m: MethodMetrics }[]; readonly caption: string }) {
  return (
    <div className="ev-table-wrap">
      <table className="ev-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Method</th>
            <th scope="col">Coverage</th>
            <th scope="col">Accuracy when it called</th>
            <th scope="col">Sensitivity (P/LP)</th>
            <th scope="col">Specificity (B/LB)</th>
            <th scope="col">False reassurance</th>
            <th scope="col">False alarm</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ name, m }) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <RateCell r={m.coverage} />
              <RateCell r={m.accuracy} strong />
              <RateCell r={m.sensitivity} />
              <RateCell r={m.specificity} />
              <CountCell r={m.falseReassurance} danger />
              <CountCell r={m.falseAlarm} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cellTone(truth: string, call: string): string {
  if (call === 'VUS' || call === 'no-call') return 'ev-cm--abstain';
  if (truth === call) return 'ev-cm--right';
  return truth === 'P/LP' ? 'ev-cm--danger' : 'ev-cm--wrong';
}

function Confusion({ method }: { readonly method: MethodResult }) {
  const c = method.overall.confusion;
  const calls = CALLS.filter((call) => TRUTHS.some((t) => c[t][call] > 0) || call !== 'no-call');
  return (
    <figure className="ev-card">
      <figcaption className="ev-card__title">{method.name}</figcaption>
      <table className="ev-cm">
        <thead>
          <tr>
            <th scope="col">
              <span className="ev-sub">ClinVar ↓ / called →</span>
            </th>
            {calls.map((call) => (
              <th key={call} scope="col">
                {call}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TRUTHS.map((t) => (
            <tr key={t}>
              <th scope="row">{t}</th>
              {calls.map((call) => (
                <td key={call} className={c[t][call] > 0 ? cellTone(t, call) : 'ev-cm--zero'}>
                  {c[t][call]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function Confusion5() {
  const m = results.sigmafold.confusion5;
  const truths = CLASSES.filter((c) => c in m);
  return (
    <figure className="ev-card">
      <figcaption className="ev-card__title">SigmaFold, five-class (rows: ClinVar consensus)</figcaption>
      <table className="ev-cm">
        <thead>
          <tr>
            <th scope="col">
              <span className="ev-sub">ClinVar ↓ / SigmaFold →</span>
            </th>
            {CLASSES.map((c) => (
              <th key={c} scope="col" title={c}>
                {SHORT[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {truths.map((t) => {
            const truthSide = t.includes('athogenic') ? 'P/LP' : 'B/LB';
            return (
              <tr key={t}>
                <th scope="row" title={t}>
                  {SHORT[t]}
                </th>
                {CLASSES.map((c) => {
                  const n = m[t][c] ?? 0;
                  const side = c === 'Uncertain Significance' ? 'VUS' : c.includes('athogenic') ? 'P/LP' : 'B/LB';
                  return (
                    <td key={c} className={n > 0 ? cellTone(truthSide, side) : 'ev-cm--zero'}>
                      {n}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}

function CaseList({ rows, call }: { readonly rows: readonly VariantRow[]; readonly call: string }) {
  if (rows.length === 0) return <p className="ev-muted">None.</p>;
  return (
    <div className="ev-table-wrap">
      <table className="ev-table ev-table--cases">
        <thead>
          <tr>
            <th scope="col">Gene</th>
            <th scope="col">Variant</th>
            <th scope="col">ClinVar</th>
            <th scope="col">Called</th>
            <th scope="col">AlphaMissense</th>
            <th scope="col">gnomAD max AF</th>
            <th scope="col">SigmaFold</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row">{r.gene}</th>
              <td>
                <span className="ev-mono">{r.hgvs ?? r.id}</span>
                <span className="ev-sub ev-mono">
                  {r.id} · {r.consequence}
                </span>
              </td>
              <td>
                {r.clinvarUrl ? (
                  <a className="ev-link" href={r.clinvarUrl} target="_blank" rel="noreferrer">
                    {r.clinvarConsensus}
                  </a>
                ) : (
                  r.clinvarConsensus
                )}
                <span className="ev-sub">{r.stars} stars</span>
              </td>
              <td className="ev-danger">{call}</td>
              <td className="ev-num">{score(r.alphaMissense)}</td>
              <td className="ev-num">{af(r.maxAf)}</td>
              <td>{r.sigmafold.classification}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EvaluationPage() {
  const d = results.dataset;
  const sf = results.methods.find((m) => m.id === 'sigmafold')!;
  const sfo = sf.overall;
  const am = results.methods.find((m) => m.id === 'alphamissense');
  const rc = results.sigmafold.referenceCheck;
  const crit = results.sigmafold.criteriaFired;
  const vus = sfo.n - sfo.coverage.k;
  const benignLof = d.strata.find((s) => s.id === 'benign-lof');

  return (
    <div className="ev-root">
      <header className="ev-header">
        <Link href="/" className="ev-header__brand" aria-label="Back to the SigmaFold Workbench">
          <Logo size={22} title={null} />
          <span className="ev-header__product">Evaluation</span>
        </Link>
        <span className="ev-header__tagline">Scored against ClinVar expert consensus</span>
        <span className="ev-spacer" />
        <Link href="/" className="ev-chrome-btn">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          <span>Workbench</span>
        </Link>
      </header>

      <main className="ev-main">
        <section className="ev-hero">
          <p className="ev-eyebrow">Science, data and evaluation</p>
          <h1>Does the classifier agree with expert curation, and how does it fail?</h1>
          <p className="ev-lede">
            We took <strong>{d.n} real variants</strong> whose meaning ClinVar has settled at 2 stars or more ({d.byTruth['P/LP']}{' '}
            pathogenic or likely pathogenic, {d.byTruth['B/LB']} benign or likely benign) across {d.genes} genes, at most {d.maxPerGene}{' '}
            per gene. {d.byGroup.missense} are missense and {d.byGroup.lof} are loss-of-function (stop-gain, frameshift, canonical splice).
            Each method saw only the evidence the workbench shows (gnomAD frequency, AlphaMissense, consequence). ClinVar was the hidden
            answer key.
          </p>
          <ul className="ev-stats">
            <li>
              <span className="ev-stats__value">{pct(sfo.accuracy.value, 0)}</span>
              <span className="ev-stats__label">
                SigmaFold accuracy when it commits ({sfo.accuracy.k}/{sfo.accuracy.n}, {ci(sfo.accuracy)})
              </span>
            </li>
            <li>
              <span className="ev-stats__value ev-warn">{pct(sfo.coverage.value, 0)}</span>
              <span className="ev-stats__label">
                SigmaFold coverage: {vus} of {sfo.n} left as Uncertain Significance
              </span>
            </li>
            <li>
              <span className={sfo.falseReassurance.k > 0 ? 'ev-stats__value ev-danger' : 'ev-stats__value'}>{sfo.falseReassurance.k}</span>
              <span className="ev-stats__label">
                SigmaFold false reassurance (pathogenic called benign), vs {am?.overall.falseReassurance.k ?? 'n/a'} for AlphaMissense alone
              </span>
            </li>
          </ul>
        </section>

        <section className="ev-section">
          <h2>Headline results</h2>
          <p className="ev-prose">
            Coverage is the share of variants given a decisive P/LP or B/LB call. Sensitivity and specificity count a VUS or no-call as a
            miss. False reassurance (ClinVar P/LP called B/LB) is the clinically dangerous error. Intervals are Wilson 95%.
          </p>
          <MetricsTable caption={`All ${String(d.n)} variants`} rows={results.methods.map((m) => ({ name: m.name, m: m.overall }))} />
          <div className="ev-split">
            <MetricsTable
              caption={`Missense only (n=${String(sf.missense.n)})`}
              rows={results.methods.map((m) => ({ name: m.name, m: m.missense }))}
            />
            <MetricsTable
              caption={`Loss of function only (n=${String(sf.lof.n)})`}
              rows={results.methods.map((m) => ({ name: m.name, m: m.lof }))}
            />
          </div>
          <ul className="ev-rules">
            {results.methods.map((m) => (
              <li key={m.id}>
                <strong>{m.name}.</strong> {m.rule}
              </li>
            ))}
            {results.omittedMethods.map((o) => (
              <li key={o.id} className="ev-muted">
                <strong>Baseline C: CADD alone, not run.</strong> {o.reason}
              </li>
            ))}
          </ul>
        </section>

        <section className="ev-section">
          <h2>What it means</h2>
          <div className="ev-prose">
            <p>
              <strong>SigmaFold is conservative by design, and that shows up as low coverage.</strong> It left {vus} of {sfo.n} variants (
              {pct(vus / sfo.n)}) as Uncertain Significance. The engine implements 8 of the ~28 ACMG/AMP criteria, so a missense variant can
              reach at most PM2 + PP3 = 3 points, which is still VUS, and Likely Benign is unreachable by points. Its benign calls come only
              from the BA1 frequency rule (fired {crit.BA1 ?? 0} times) and its pathogenic calls only from PVS1 (fired {crit.PVS1 ?? 0}{' '}
              times; {frac(results.sigmafold.lofPathogenicInCuratedGenes)} of pathogenic loss-of-function variants are in its hand-curated
              gene list). The decisive calls it does make are the easy ones: common variants, and truncating variants in well-known disease
              genes.
            </p>
            <p>
              <strong>AlphaMissense alone covers far more missense variants</strong> ({am ? frac(am.missense.coverage) : 'n/a'}) at{' '}
              {am ? frac(am.missense.accuracy) : 'n/a'} accuracy, but it cannot score loss-of-function variants and it made{' '}
              {am?.overall.falseReassurance.k ?? 0} false-reassurance calls. SigmaFold uses the same score only as supporting evidence at
              stricter cut-offs (≥ 0.7 / &lt; 0.3, worth +1 / −1 point), so those errors become a VUS rather than a confident wrong answer.
            </p>
          </div>
        </section>

        <section className="ev-section">
          <h2>Would the product catch SigmaFold&apos;s mistakes?</h2>
          <div className="ev-prose">
            <p>
              In the workbench, a classification on the other side of the actionable line from ClinVar (P/LP versus anything else) is a{' '}
              <strong>major disagreement</strong>, and merge is blocked until a named human signs off with a rationale.
            </p>
          </div>
          <ul className="ev-stats ev-stats--compact">
            <li>
              <span className="ev-stats__value">{rc.majorFlags}</span>
              <span className="ev-stats__label">of {sfo.n} variants would trigger human sign-off</span>
            </li>
            <li>
              <span className="ev-stats__value">
                {rc.decisiveErrorsFlagged}/{rc.decisiveErrors}
              </span>
              <span className="ev-stats__label">confident wrong calls flagged</span>
            </li>
            <li>
              <span className="ev-stats__value">
                {rc.pathogenicAbstentionsFlagged}/{rc.pathogenicAbstentions}
              </span>
              <span className="ev-stats__label">pathogenic variants left at VUS flagged</span>
            </li>
            <li>
              <span className="ev-stats__value">{rc.benignAbstentionsUnflagged}</span>
              <span className="ev-stats__label">benign variants left at VUS: same side of the line, recorded as minor</span>
            </li>
          </ul>
          <p className="ev-prose ev-muted">
            This safety net only works when ClinVar already has a confident record. For a genuinely novel variant there is no reference to
            disagree with, and the VUS itself is the signal that a human must decide.
          </p>
        </section>

        <section className="ev-section">
          <h2>Confusion matrices</h2>
          <p className="ev-prose">
            Green: agrees with ClinVar. Grey: abstained (VUS or no call). Red: pathogenic called benign. Amber: benign called pathogenic.
          </p>
          <div className="ev-grid">
            <Confusion5 />
            {results.methods.map((m) => (
              <Confusion key={m.id} method={m} />
            ))}
          </div>
        </section>

        <section className="ev-section">
          <h2>False-reassurance cases</h2>
          <p className="ev-prose">ClinVar says pathogenic or likely pathogenic; the method said benign.</p>
          {results.methods.map((m) => (
            <div key={m.id} className="ev-cases">
              <h3>
                {m.name} <span className="ev-muted">({(results.falseReassurance[m.id] ?? []).length})</span>
              </h3>
              <CaseList rows={results.falseReassurance[m.id] ?? []} call="B/LB" />
            </div>
          ))}
          <h3 className="ev-h3-gap">False alarms (ClinVar benign, called pathogenic)</h3>
          {results.methods
            .filter((m) => (results.falseAlarm[m.id] ?? []).length > 0)
            .map((m) => (
              <div key={m.id} className="ev-cases">
                <h3>
                  {m.name} <span className="ev-muted">({(results.falseAlarm[m.id] ?? []).length})</span>
                </h3>
                <CaseList rows={results.falseAlarm[m.id] ?? []} call="P/LP" />
              </div>
            ))}
          {results.methods.every((m) => (results.falseAlarm[m.id] ?? []).length === 0) && <p className="ev-muted">None.</p>}
        </section>

        <section className="ev-section">
          <h2>Limitations and circularity</h2>
          <ul className="ev-prose ev-list">
            <li>
              <strong>Agreement is partly circular.</strong> ClinVar curators use gnomAD frequency and computational predictors as ACMG
              evidence, and the AlphaMissense thresholds (0.34 / 0.564) were calibrated against ClinVar labels. This benchmark measures
              consistency with expert curation, not clinical validity, and it flatters every method that uses those signals.
            </li>
            <li>
              <strong>Easy cases are over-represented.</strong> 2-star-plus consensus variants are the ones experts could settle. Real
              diagnostic queues are dominated by rare missense VUS, where every method here would do worse.
            </li>
            <li>
              <strong>Small sample.</strong> {d.n} variants give wide confidence intervals; differences of a few variants are not meaningful.
            </li>
            <li>
              <strong>Scoped engine.</strong> 8 of ~28 criteria, simplified PVS1 (consequence plus a curated gene list, no NMD or last-exon
              check). A transparent rule engine for demonstration, not a certified clinical tool.
            </li>
            <li>
              <strong>Sampling.</strong> Candidates come from seeded random pages of MyVariant.info search results, not a uniform draw from
              ClinVar. Benign loss-of-function variants are rare ({benignLof?.total ?? 0} search hits in total) and may be atypical.
            </li>
          </ul>
        </section>

        <section className="ev-section">
          <h2>Dataset and licences</h2>
          <div className="ev-prose">
            <p>
              <strong>Real public reference data, not patient data.</strong> {d.dataNote}
            </p>
            <p>
              Fetched {d.fetchedAt.slice(0, 10)} from <span className="ev-mono">{d.api}</span> (assembly hg38) using the evidence service&apos;s
              own field list. Sampling seed <span className="ev-mono">{d.seed}</span>, at most {d.geneCap} variants per gene. {d.inclusion}
            </p>
          </div>
          <div className="ev-table-wrap">
            <table className="ev-table ev-table--strata">
              <caption>Sampling strata (exact MyVariant.info queries)</caption>
              <thead>
                <tr>
                  <th scope="col">Stratum</th>
                  <th scope="col">Query</th>
                  <th scope="col">Hits</th>
                  <th scope="col">Eligible</th>
                  <th scope="col">Selected</th>
                </tr>
              </thead>
              <tbody>
                {d.strata.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">{s.id}</th>
                    <td className="ev-mono ev-query">{s.query}</td>
                    <td className="ev-num">{s.total.toLocaleString('en-GB')}</td>
                    <td className="ev-num">{s.eligible}</td>
                    <td className="ev-num">
                      {s.selected}/{s.target}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="ev-licences">
            {d.licences.map((l) => (
              <li key={l.name}>
                <strong>{l.name}</strong>
                <span>{l.licence}</span>
                <a className="ev-link" href={l.licenceUrl} target="_blank" rel="noreferrer">
                  Terms
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="ev-section">
          <h2>Reproduce</h2>
          <pre className="ev-pre">
            {'pnpm eval         # offline: scores src/data/eval/benchmark.json, writes results.json and docs/EVALUATION.md\n'}
            {'pnpm eval:build   # live: re-samples the benchmark from MyVariant.info (results shift as ClinVar updates)'}
          </pre>
        </section>
      </main>
    </div>
  );
}
