import { handle, json, readJson } from '@/lib/workbench/http';
import { getWorkbench } from '@/lib/workbench/runtime';
import { parseSignoff } from '@/lib/workbench/validate';

export const runtime = 'nodejs';

/** POST /api/workbench/signoff: SignoffRequest -> WorkspaceSnapshot */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => json(getWorkbench().signoff(parseSignoff(await readJson(request)))));
}
