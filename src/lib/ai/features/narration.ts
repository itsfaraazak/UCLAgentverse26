import '../server-only';
import type { DeltaDAGView } from '@/lib/agents';
import { isIntentPayload, isScreenPayload } from '@/lib/agents';
import type { ScreenResult } from '@/lib/safety/policy';
import { clampProse, extractJsonObject, requireString } from '../json';
import {
  describeFailure,
  screenedComplete,
  type FeatureOptions,
} from './call';

/**
 * Read-only plain-English summary of an already-computed DeltaDAG.
 *
 * Narration must not influence any decision: it never writes back to the DAG
 * and its output is display text only. Refused (redacted) runs are not sent
 * to a third-party API.
 */

const MAX_OUTPUT_CHARS = 8_192;
const MAX_SUMMARY_CHARS = 2_000;

export type NarrationResult =
  | {
      readonly status: 'ai';
      readonly summary: string;
      readonly providerId: string;
      readonly model: string;
    }
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'refused'; readonly category: string; readonly requestDigest: string }
  | { readonly status: 'failed'; readonly reason: string };

const SYSTEM = [
  'Summarise this completed genome-edit simulation for a scientist.',
  'Return a single JSON object and nothing else: {"summary": string}.',
  'Be faithful to the record. Do not invent findings, sequences, or advice.',
  'Do not propose laboratory steps, guides, primers, or protocols.',
].join(' ');

function screenFromDag(dag: DeltaDAGView): ScreenResult | undefined {
  for (const delta of dag.all()) {
    if (isScreenPayload(delta.payload)) {
      const p = delta.payload;
      return {
        category: p.category,
        verdict: p.verdict,
        reason: p.reason,
        requiresSignoff: p.requiresSignoff,
        signoffRole: p.signoffRole,
        flaggedGenes: p.flaggedGenes,
        requestDigest: p.requestDigest,
        redacted: p.redacted,
      };
    }
  }
  return undefined;
}

function intentTargets(dag: DeltaDAGView): readonly string[] {
  for (const delta of dag.all()) {
    if (isIntentPayload(delta.payload)) return delta.payload.targets;
  }
  return [];
}

function dagSnapshot(dag: DeltaDAGView): unknown {
  return dag.all().map((d) => ({
    kind: d.kind,
    author: d.author,
    subject: d.subject,
    payload: d.payload,
  }));
}

export async function narrateDeltaDag(
  dag: DeltaDAGView,
  options: FeatureOptions = {},
): Promise<NarrationResult> {
  const prior = screenFromDag(dag);
  if (prior === undefined) {
    return { status: 'failed', reason: 'dag has no screen result' };
  }
  if (prior.redacted) {
    return {
      status: 'refused',
      category: prior.category,
      requestDigest: prior.requestDigest,
    };
  }

  const snapshot = dagSnapshot(dag);
  const prompt = JSON.stringify(snapshot);
  const call = await screenedComplete(
    { text: prompt, targets: [...intentTargets(dag)] },
    `Summarise this completed run as JSON {"summary": string}:\n${prompt}`,
    options,
    { maxOutputChars: MAX_OUTPUT_CHARS, system: SYSTEM },
  );

  if (call.kind === 'refused') {
    return {
      status: 'refused',
      category: call.lexical.category,
      requestDigest: call.lexical.requestDigest,
    };
  }
  if (call.kind === 'unavailable') {
    return { status: 'unavailable', reason: call.reason };
  }
  if (call.kind === 'failed') {
    return { status: 'failed', reason: call.reason };
  }

  try {
    const obj = extractJsonObject(call.text);
    const summary = clampProse(requireString(obj, 'summary'), MAX_SUMMARY_CHARS);
    if (summary.length === 0) {
      return { status: 'failed', reason: 'malformed output' };
    }
    return {
      status: 'ai',
      summary,
      providerId: call.provider.id,
      model: call.provider.model,
    };
  } catch (err) {
    return { status: 'failed', reason: describeFailure(err) };
  }
}
