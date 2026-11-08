import { handle, json, readJson } from '@/lib/workbench/http';
import { getWorkbench } from '@/lib/workbench/runtime';
import { parseCreateBranch } from '@/lib/workbench/validate';

export const runtime = 'nodejs';

/** POST /api/workbench/branches: CreateBranchRequest -> WorkspaceSnapshot */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => json(getWorkbench().createBranch(parseCreateBranch(await readJson(request)))));
}
