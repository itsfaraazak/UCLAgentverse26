import { handle, json, readJson } from '@/lib/workbench/http';
import { getWorkbench } from '@/lib/workbench/runtime';
import { parseAssert } from '@/lib/workbench/validate';

export const runtime = 'nodejs';

/** POST /api/workbench/assert: AssertRequest -> WorkspaceSnapshot (re-runs the classifier). */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => json(await getWorkbench().assert(parseAssert(await readJson(request)))));
}
