import { handle, json, ndjson, readJson } from '@/lib/workbench/http';
import { getWorkbench } from '@/lib/workbench/runtime';
import { parseComment } from '@/lib/workbench/validate';

export const runtime = 'nodejs';
export const maxDuration = 600;

/** POST /api/workbench/comment: CommentRequest -> NDJSON stream when askAgent, else WorkspaceSnapshot. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const result = getWorkbench().comment(parseComment(await readJson(request)));
    return typeof result === 'function' ? ndjson(result) : json(result);
  });
}
