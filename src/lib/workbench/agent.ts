import type { EvidenceService } from '../evidence/types';
import type { StreamEvent } from './api-types';
import { runFallback } from './fallback';
import { describeAiError, forceFallback, type GeminiClient, type GeminiContent, type GeminiPart } from './gemini';
import { SYSTEM_PROMPT, userTurn } from './prompts';
import type { AppendInput, WorkbenchStore } from './store';
import { TOOL_DECLARATIONS, emptyRunState, executeTool, type ToolContext } from './tools';
import type { Actor, RequestMode, WbDelta, WbDeltaKind } from './types';

/** Each Argon turn costs ~15-30s; a typical run is 2-3 turns. */
export const MAX_MODEL_TURNS = 6;

export interface AgentTrigger {
  readonly kind: 'prompt' | 'comment';
  readonly text: string;
  readonly deltaId: string;
  readonly mode: RequestMode;
  readonly author: string;
}

export interface RunAgentOptions {
  readonly branch: string;
  readonly trigger: AgentTrigger;
  readonly emit: (event: StreamEvent) => void;
  readonly evidence: EvidenceService;
  readonly store: WorkbenchStore;
  /** null runs the deterministic pipeline only. */
  readonly gemini: GeminiClient | null;
}

const PIPELINE_ACTOR: Actor = { kind: 'agent', name: 'Deterministic pipeline', model: null };

function planSteps(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, 8);
}

/**
 * One agent run on a branch: model turns with tool calls, falling back to
 * the deterministic pipeline on any model failure. The caller owns branch
 * status; this only appends deltas.
 */
export async function runAgent(opts: RunAgentOptions): Promise<void> {
  const { branch, trigger, emit, store } = opts;
  const progress = (message: string) => emit({ type: 'progress', branch, message });
  const ctx: ToolContext = {
    store,
    branch,
    evidence: opts.evidence,
    mode: trigger.mode,
    triggerText: trigger.text,
    state: emptyRunState(),
    add<K extends WbDeltaKind>(input: AppendInput<K>): WbDelta<K> {
      const delta = store.append(branch, input);
      emit({ type: 'delta', delta });
      return delta as unknown as WbDelta<K>;
    },
    progress,
  };

  const fallback = async (reason: string) => {
    ctx.add({
      kind: 'error',
      actor: PIPELINE_ACTOR,
      title: 'Language model unavailable',
      body: `${reason} Continuing with the deterministic pipeline.`,
      data: { message: `${reason} Continuing with the deterministic pipeline.`, recoverable: true },
    });
    progress('Running the deterministic pipeline');
    await runFallback(ctx, trigger.text);
  };

  if (opts.gemini === null || forceFallback()) {
    await fallback(
      forceFallback()
        ? 'The language model is disabled for this workspace (WORKBENCH_FORCE_FALLBACK=1).'
        : 'No language model is configured.',
    );
    return;
  }

  const gemini = opts.gemini;
  const history = store.ancestry(branch).filter((d) => d.id !== trigger.deltaId);
  const contents: GeminiContent[] = [
    { role: 'user', parts: [{ text: userTurn(history, trigger) }] },
  ];
  const analyst: Actor = { kind: 'agent', name: 'Gemini analyst', model: gemini.model };
  let planned = false;

  try {
    for (let turn = 0; turn < MAX_MODEL_TURNS; turn++) {
      const last = turn === MAX_MODEL_TURNS - 1;
      progress(`Asking ${gemini.model} (can take ~20s)`);
      const result = await gemini.generate({ system: SYSTEM_PROMPT, contents, tools: TOOL_DECLARATIONS, forceText: last });
      contents.push(result.content);

      if (result.calls.length === 0) {
        if (result.text.length === 0) throw new Error('empty answer');
        ctx.add({ kind: 'message', actor: analyst, title: `${gemini.model} summary`, data: { markdown: result.text } });
        return;
      }

      if (result.text.length > 0 && !planned) {
        planned = true;
        ctx.add({ kind: 'plan', actor: analyst, title: 'Plan', body: result.text.slice(0, 300), data: { steps: planSteps(result.text) } });
      }

      const responses = await Promise.all(
        result.calls.map(async (call): Promise<GeminiPart> => ({
          functionResponse: {
            name: call.name,
            ...(call.id ? { id: call.id } : {}),
            response: await executeTool(ctx, call.name, call.args),
          },
        })),
      );
      contents.push({ role: 'user', parts: responses });
    }
    throw new Error('turn limit reached');
  } catch (err) {
    await fallback(describeAiError(err));
  }
}
