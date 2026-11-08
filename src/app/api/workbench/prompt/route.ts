import { handle, ndjson, readJson } from '@/lib/workbench/http';
import { getWorkbench } from '@/lib/workbench/runtime';
import { parsePrompt } from '@/lib/workbench/validate';

export const runtime = 'nodejs';
export const maxDuration = 600;

/** POST /api/workbench/prompt: PromptRequest -> NDJSON StreamEvent lines (409 if the branch is busy). */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => ndjson(getWorkbench().preparePrompt(parsePrompt(await readJson(request)))));
}
