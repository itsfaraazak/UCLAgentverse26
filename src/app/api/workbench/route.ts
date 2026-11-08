import { connection } from 'next/server';
import { handle, json } from '@/lib/workbench/http';
import { getWorkbench } from '@/lib/workbench/runtime';

/** GET /api/workbench -> WorkspaceSnapshot */
export async function GET(): Promise<Response> {
  await connection();
  return handle(() => json(getWorkbench().snapshot()));
}
