import { handle, json, readJson } from '@/lib/workbench/http';
import { getWorkbench } from '@/lib/workbench/runtime';
import { parseMerge } from '@/lib/workbench/validate';

/** POST /api/workbench/merge: MergeRequest -> MergeResponse (200 either way; `merged` says which). */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => json(getWorkbench().merge(parseMerge(await readJson(request)))));
}
