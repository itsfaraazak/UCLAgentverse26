import './server-only';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE GEMINI MODEL FOR THIS PROJECT IS `gemini-4-argon`. DO NOT CHANGE IT.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Argon is required. No Flash variant may be substituted — not for intent
 * parsing, not for narration, not for the second-opinion screen, and not as a
 * "cheap fallback". Specifically excluded: `gemini-2.5-flash`,
 * `gemini-3.5-flash`, and every other `*-flash` / `*-flash-lite` model.
 *
 * If Argon errors, the correct behaviour is to surface the error and degrade
 * to the clearly-labelled non-AI path. Silently falling back to a different
 * model would make the AI path's provenance unverifiable, which is the one
 * thing this project cannot afford — a reviewer must be able to tell which
 * model produced which text, or whether any model did at all.
 *
 * `assertNotFlash` below makes an accidental swap a runtime error rather than
 * a quiet downgrade, and `models.test.ts` pins the constant.
 *
 * Verified present on `generativelanguage.googleapis.com/v1beta/models`.
 */
export const GEMINI_MODEL = 'gemini-4-argon';

/** Google Generative Language REST base. */
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Model families this project refuses to run on, by substring.
 *
 * This is a guard against accident, not against a determined edit: anyone
 * editing `GEMINI_MODEL` can edit this too. Its job is to catch a swap made
 * while debugging ("let me just try Flash") before it reaches a commit.
 */
const REFUSED_MODEL_SUBSTRINGS: readonly string[] = Object.freeze([
  'flash',
  'flash-lite',
  'lite',
]);

/**
 * Throw if `model` is in a refused family.
 *
 * Called on the configured model at provider construction, so a bad value
 * fails at startup rather than mid-demo.
 */
export function assertNotFlash(model: string): string {
  const lowered = model.toLowerCase();
  const hit = REFUSED_MODEL_SUBSTRINGS.find((s) => lowered.includes(s));
  if (hit !== undefined) {
    throw new Error(
      `refusing to use model '${model}': this project requires '${GEMINI_MODEL}' and ` +
        `must never substitute a '${hit}' variant. If Argon is failing, surface the ` +
        `error and fall back to the non-AI path — do not change the model.`,
    );
  }
  return model;
}

/** The `generateContent` endpoint for a model. The key goes in the query string. */
export function geminiGenerateContentUrl(model: string, apiKey: string): string {
  // Verified: the key must be the `key=` query parameter. A `Bearer`
  // Authorization header returns 401 against this API.
  return `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

/** The model-discovery endpoint, used to check Argon is actually present. */
export function geminiListModelsUrl(apiKey: string): string {
  return `${GEMINI_API_BASE}/models?key=${encodeURIComponent(apiKey)}&pageSize=200`;
}
