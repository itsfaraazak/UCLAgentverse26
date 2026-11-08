import { GEMINI_MODEL } from '../ai/models';
import type { AnyDelta, RequestMode } from './types';

export const SYSTEM_PROMPT = `You are a variant-interpretation agent (${GEMINI_MODEL}) working alongside clinical scientists on a shared, append-only case history. Every tool result becomes a delta with an id.

Rules:
- Never invent evidence, numbers, papers or citations. Use only tool results and the case history.
- Cite the delta ids that support each claim in square brackets, exactly as given, e.g. [a1b2c3d4].
- You cannot change the classification, dismiss ACMG criteria or sign off. Only humans can. You may suggest what a human should review.
- The ACMG classification comes from a deterministic classifier that never sees ClinVar. When it, AlphaMissense or population frequency disagree with ClinVar, explain likely reasons (for example recessive disorders where carriers are common or have a selective advantage, gain-of-function or dominant-negative mechanisms that missense predictors capture poorly, splice effects, low ClinVar review status) and say what a human should check.
- Edits: only call propose_correction when the human asked for an edit. You never design guides, primers, vectors or protocols.
- Write for clinicians: short, plain English, markdown, no preamble.

Working style (each of your turns is slow, so use few):
- In your first response write a one-line plan and call the tools you need in the same turn. Batch independent calls in parallel (for example lookup_variant and search_literature together).
- lookup_variant already runs the ACMG classifier and the ClinVar comparison; do not ask for them separately.
- After the tool results arrive, answer. Do not call tools again unless something essential is missing.`;

function short(id: string): string {
  return id.slice(0, 8);
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Compact key data per delta kind; the transcript is a summary, not a dump. */
function keyData(d: AnyDelta): string {
  switch (d.kind) {
    case 'gate':
      return `mode=${d.data.mode} verdict=${d.data.verdict} category=${d.data.category}${d.data.signoffRole ? ` signoffRole=${d.data.signoffRole}` : ''}`;
    case 'evidence': {
      const e = d.data.evidence;
      return `variant=${e.variant.id} gene=${e.variant.gene} protein=${e.variant.hgvsProtein} maxAf=${e.population.maxAf} alphaMissense=${e.predictors.alphaMissense} cadd=${e.predictors.caddPhred}`;
    }
    case 'interpretation': {
      const i = d.data.interpretation;
      const met = i.engine.criteria.filter((c) => c.met).map((c) => c.code);
      return `classification=${i.classification} points=${i.points} met=${met.join(',') || 'none'} dismissed=${i.dismissed.map((x) => x.code).join(',') || 'none'}`;
    }
    case 'reference': {
      const c = d.data.comparison;
      return `clinvar=${c.clinvar.consensus} stars=${c.clinvar.stars} severity=${c.severity}`;
    }
    case 'literature':
      return d.data.result.papers
        .slice(0, 5)
        .map((p) => `PMID ${p.pmid ?? 'n/a'}: ${oneLine(p.title, 90)}`)
        .join('; ');
    case 'edit':
      return `gene=${d.data.gene} verdict=${d.data.gate.verdict} category=${d.data.gate.category}`;
    case 'assertion':
      return d.data.kind === 'dismiss' ? `dismiss ${d.data.code}: ${oneLine(d.data.reason, 120)}` : `segregation=${d.data.value}: ${oneLine(d.data.reason, 120)}`;
    case 'signoff':
      return `final=${d.data.finalClassification} covers=${d.data.covers ? short(d.data.covers) : 'none'}`;
    case 'message':
      return oneLine(d.data.markdown, 400);
    case 'comment':
      return oneLine(d.data.text, 300);
    case 'prompt':
      return oneLine(d.data.text, 300);
    default:
      return '';
  }
}

function actorLabel(d: AnyDelta): string {
  return d.actor.kind === 'human' ? `${d.actor.name}${d.actor.role ? ` (${d.actor.role})` : ''}` : d.actor.name;
}

export function transcript(deltas: readonly AnyDelta[]): string {
  return deltas
    .map((d) => {
      const data = keyData(d);
      return `[${short(d.id)}] ${actorLabel(d)} ${d.kind}: ${oneLine(d.title, 120)}${d.body ? ` - ${oneLine(d.body, 200)}` : ''}${data ? ` {${data}}` : ''}`;
    })
    .join('\n');
}

export function userTurn(history: readonly AnyDelta[], trigger: { readonly text: string; readonly mode: RequestMode; readonly author: string }): string {
  return [
    'Case history so far (oldest first):',
    history.length > 0 ? transcript(history) : '(empty)',
    '',
    `New message from ${trigger.author} (screened as ${trigger.mode === 'edit' ? 'an edit request' : 'an interpretation request'}):`,
    trigger.text,
  ].join('\n');
}
