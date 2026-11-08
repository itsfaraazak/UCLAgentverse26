import '../server-only';
import { loadLoci } from '@/lib/genome';
import { FLAGGED_LOCI } from '@/lib/safety/policy';
import {
  extractJsonObject,
  requireEnum,
  requireStringArray,
} from '../json';
import {
  describeFailure,
  screenedComplete,
  type FeatureOptions,
} from './call';

/**
 * AI-assisted intent parse. The model may only *narrow* free text onto the
 * curated gene allow-list; it cannot introduce a symbol that is not already
 * in `loadLoci()` ∪ `FLAGGED_LOCI`.
 */

export const INTENT_OPERATIONS = ['repair', 'introduce', 'disrupt', 'silent', 'unresolved'] as const;
export type IntentOperation = (typeof INTENT_OPERATIONS)[number];

const MAX_TARGETS = 8;
const MAX_OUTPUT_CHARS = 4_096;

const ALLOWED_TARGETS: readonly string[] = Object.freeze(
  [...new Set([...loadLoci().map((l) => l.gene.toUpperCase()), ...FLAGGED_LOCI.map((l) => l.gene.toUpperCase())])].sort(),
);

export function allowedTargets(): readonly string[] {
  return ALLOWED_TARGETS;
}

function keepAllowed(proposed: readonly string[]): string[] {
  const kept = new Set<string>();
  for (const raw of proposed) {
    const key = raw.trim().toUpperCase();
    if (ALLOWED_TARGETS.some((g) => g === key)) kept.add(key);
  }
  return [...kept].sort();
}

/**
 * Gene symbols already present in the user text. Used only so `screen()` can
 * classify the request before any outbound call — the model still cannot
 * introduce a symbol that is not on the allow-list.
 */
function mentionedAllowedTargets(text: string): string[] {
  const found: string[] = [];
  for (const gene of ALLOWED_TARGETS) {
    const re = new RegExp(`\\b${gene}\\b`, 'i');
    if (re.test(text)) found.push(gene);
  }
  return found;
}

export type IntentParseResult =
  | {
      readonly status: 'ai';
      readonly targets: readonly string[];
      readonly operation: IntentOperation;
      readonly providerId: string;
      readonly model: string;
    }
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'refused'; readonly category: string; readonly requestDigest: string }
  | { readonly status: 'failed'; readonly reason: string };

const SYSTEM = [
  'Return a single JSON object and nothing else.',
  'Shape: {"targets": string[], "operation": string}.',
  `operation must be one of: ${INTENT_OPERATIONS.join(', ')}.`,
  `targets must be drawn from this closed allow-list: ${ALLOWED_TARGETS.join(', ')}.`,
  'Never invent a gene symbol. If nothing matches, return an empty targets array.',
].join(' ');

export async function interpretIntent(
  text: string,
  options: FeatureOptions = {},
): Promise<IntentParseResult> {
  const call = await screenedComplete(
    { text, targets: mentionedAllowedTargets(text) },
    `Parse this request:\n${text}`,
    options,
    {
      maxOutputChars: MAX_OUTPUT_CHARS,
      system: SYSTEM,
    },
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
    const operation = requireEnum(obj, 'operation', INTENT_OPERATIONS);
    const proposed = requireStringArray(obj, 'targets', MAX_TARGETS);
    return {
      status: 'ai',
      targets: keepAllowed(proposed),
      operation,
      providerId: call.provider.id,
      model: call.provider.model,
    };
  } catch (err) {
    return { status: 'failed', reason: describeFailure(err) };
  }
}
