import { handle, json } from '@/lib/workbench/http';
import { getWorkbench } from '@/lib/workbench/runtime';

/** POST /api/workbench/reset -> WorkspaceSnapshot. Clears the workspace. */
export async function POST(): Promise<Response> {
  return handle(() => json(getWorkbench().reset()));
}
