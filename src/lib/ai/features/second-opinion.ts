import '../server-only';
import { POLICY, type PolicyCategory, type ScreenInput } from '@/lib/safety/policy';
import {
  combineScreen,
  type CombinedScreen,
  type ModelOpinion,
} from '../guard';
import {
  extractJsonObject,
  requireBoolean,
  optionalString,
  AiSchemaError,
} from '../json';
import {
  describeFailure,
  screenedComplete,
  type FeatureOptions,
} from './call';

/**
 * Ask a model for a category *label* from the closed POLICY set, then combine
 * it with the authoritative lexical screen. The model's raw response is never
 * itself a verdict — `combineScreen` reads the verdict out of `POLICY`.
 */

const CATEGORIES: readonly PolicyCategory[] = Object.freeze(
  Object.keys(POLICY) as PolicyCategory[],
);

const MAX_OUTPUT_CHARS = 2_048;

export type SecondOpinionResult = CombinedScreen & {
  readonly status: 'ai' | 'unavailable' | 'refused' | 'failed';
  readonly reason?: string;
};

const SYSTEM = [
  'Classify the request into the closed policy category set.',
  'Return a single JSON object and nothing else.',
  'Shape: {"concern": boolean, "category": string}.',
  `category must be one of: ${CATEGORIES.join(', ')}.`,
  'Do not return a verdict. Do not include a verdict field.',
  'concern is true when the request raises a biosafety issue in that category.',
].join(' ');

function parseOpinion(raw: string): ModelOpinion {
  const obj = extractJsonObject(raw);
  if (Object.prototype.hasOwnProperty.call(obj, 'verdict')) {
    throw new AiSchemaError('a model must return a category label, not a verdict');
  }
  const concern = requireBoolean(obj, 'concern');
  const category = optionalString(obj, 'category');
  if (!concern) {
    return { concern: false, ...(category === undefined ? {} : { category }) };
  }
  return { concern: true, ...(category === undefined ? {} : { category }) };
}

export async function secondOpinion(
  input: ScreenInput,
  options: FeatureOptions = {},
): Promise<SecondOpinionResult> {
  const prompt = `Classify this request. JSON only.\n${input.text}`;
  const call = await screenedComplete(input, prompt, options, {
    maxOutputChars: MAX_OUTPUT_CHARS,
    system: SYSTEM,
  });

  if (call.kind === 'refused') {
    return {
      ...combineScreen(call.lexical),
      status: 'refused',
      reason: 'content is not transmissible',
    };
  }
  if (call.kind === 'unavailable') {
    return {
      ...combineScreen(call.lexical),
      status: 'unavailable',
      reason: call.reason,
    };
  }
  if (call.kind === 'failed') {
    return {
      ...combineScreen(call.lexical),
      status: 'failed',
      reason: call.reason,
    };
  }

  try {
    const opinion = parseOpinion(call.text);
    return {
      ...combineScreen(call.lexical, opinion),
      status: 'ai',
    };
  } catch (err) {
    return {
      ...combineScreen(call.lexical),
      status: 'failed',
      reason: describeFailure(err),
    };
  }
}
