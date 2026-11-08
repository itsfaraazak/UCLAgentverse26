import { literatureQueryFor } from '../evidence';
import { latestOfKind, referenceFor } from './merge';
import { extractVariantQuery } from './query';
import {
  executeTool,
  proposeCorrection,
  short,
  variantLabel,
  type ToolContext,
} from './tools';
import type { Actor } from './types';

export const DETERMINISTIC_PIPELINE: Actor = { kind: 'agent', name: 'Deterministic pipeline', model: null };

/**
 * The non-AI path. Same tools and required checks as the agent, run in a
 * fixed order, then a templated summary. Steps already done in this run (by
 * the model before it failed) are reused, not repeated.
 */
export async function runFallback(ctx: ToolContext, text: string): Promise<void> {
  const s = ctx.state;
  const query = s.evidence === null ? extractVariantQuery(text) : null;
  const prior = latestOfKind(ctx.store.ancestry(ctx.branch), 'evidence');

  if (s.evidence === null && query === null && prior === null) {
    ctx.add({
      kind: 'message',
      actor: DETERMINISTIC_PIPELINE,
      title: 'Which variant?',
      data: {
        markdown:
          'I could not find a variant in that request. Give an rsID (for example `rs334`) or a gene with HGVS (for example `BRCA1 c.5266dupC` or `HBB p.Glu7Val`).',
      },
    });
    return;
  }

  ctx.add({
    kind: 'plan',
    actor: DETERMINISTIC_PIPELINE,
    title: 'Deterministic plan',
    data: {
      steps: [
        ...(s.evidence === null && query !== null ? [`Look up ${query} and run the ACMG and ClinVar checks`] : []),
        ...(s.literature === null ? ['Search the literature'] : []),
        ...(ctx.mode === 'edit' && s.edit === null ? ['Propose a correction and screen it'] : []),
        'Summarise for human review',
      ],
    },
  });

  if (s.evidence === null && query !== null) await executeTool(ctx, 'lookup_variant', { query });

  const evidence = s.evidence ?? prior;
  if (evidence !== null && s.literature === null) {
    await executeTool(ctx, 'search_literature', { query: literatureQueryFor(evidence.data.evidence) });
  }
  if (ctx.mode === 'edit' && s.edit === null && evidence !== null) proposeCorrection(ctx);

  ctx.add({ kind: 'message', actor: DETERMINISTIC_PIPELINE, title: 'Summary (no language model)', data: { markdown: summary(ctx) } });
}

function summary(ctx: ToolContext): string {
  const s = ctx.state;
  const history = ctx.store.ancestry(ctx.branch);
  const evidence = s.evidence ?? latestOfKind(history, 'evidence');
  if (evidence === null) {
    return 'The variant lookup failed, so there is nothing to classify yet. Check the identifier and try again with an rsID or gene + HGVS.';
  }
  const lines: string[] = [];
  const e = evidence.data.evidence;
  const af = e.population.maxAf;
  lines.push(
    `**${variantLabel(e)}**: ${e.consequence}; gnomAD max AF ${af === null ? 'absent' : af.toExponential(2)}; AlphaMissense ${e.predictors.alphaMissense ?? 'n/a'}${e.predictors.alphaMissenseClass ? ` (${e.predictors.alphaMissenseClass.replace('_', ' ')})` : ''} [${short(evidence.id)}]`,
  );
  const interp = s.interpretation ?? latestOfKind(history, 'interpretation');
  if (interp !== null) {
    const i = interp.data.interpretation;
    const met = i.engine.criteria.filter((c) => c.met && !i.dismissed.some((d) => d.code === c.code)).map((c) => c.code);
    lines.push(`- ACMG classifier: **${i.classification}** (${i.points} points; ${met.join(', ') || 'no criteria met'}) [${short(interp.id)}]`);
    const ref = s.reference ?? referenceFor(history, interp);
    if (ref !== null) {
      const c = ref.data.comparison;
      lines.push(`- ClinVar: ${c.clinvar.consensus ?? 'no consensus'} (${c.clinvar.stars}★) - ${c.severity === 'none' ? 'agrees' : c.severity === 'unavailable' ? 'not comparable' : `${c.severity} disagreement`} [${short(ref.id)}]`);
      if (c.severity === 'major') lines.push('  A human must review this disagreement before sign-off.');
    }
  }
  if (s.literature !== null) {
    lines.push(`- Literature: ${s.literature.data.result.papers.length} papers [${short(s.literature.id)}]`);
  }
  if (s.edit !== null) {
    const g = s.edit.data.gate;
    lines.push(`- Edit proposal: ${s.edit.data.description} Policy: **${g.verdict}** (${g.category}) [${short(s.edit.id)}]`);
  }
  lines.push('', 'Next: a named human reviews the evidence and signs off before this can merge.');
  return lines.join('\n');
}
