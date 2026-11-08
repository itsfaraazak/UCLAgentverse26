import type {
  AssertRequest,
  CommentRequest,
  CreateBranchRequest,
  MergeRequest,
  MergeResponse,
  PromptRequest,
  SignoffRequest,
  StreamEvent,
} from '@/lib/workbench/api-types';
import type { WorkspaceSnapshot } from '@/lib/workbench/types';

import { readNdjsonStream } from './ndjson';

const BASE = '/api/workbench';

export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

async function failure(response: Response): Promise<ApiFailure> {
  let message = `${response.status} ${response.statusText}`.trim();
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
      message = (body as { error: string }).error;
    }
  } catch {
    // not JSON
  }
  if (response.status === 404) message = `The workbench API is not available (${message}).`;
  return new ApiFailure(message, response.status);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

/**
 * POST to a streaming route. A plain JSON reply (comment without the agent)
 * is delivered as a single `done` event, so callers handle one shape.
 */
async function postStream(
  path: string,
  body: unknown,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw await failure(response);
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('ndjson') && type.includes('json')) {
    const snapshot = (await response.json()) as WorkspaceSnapshot;
    onEvent({ type: 'done', snapshot });
    return;
  }
  if (!response.body) throw new ApiFailure('The server sent an empty stream.', response.status);
  await readNdjsonStream(response.body, onEvent);
}

export const api = {
  async snapshot(): Promise<WorkspaceSnapshot> {
    const response = await fetch(BASE, { cache: 'no-store' });
    if (!response.ok) throw await failure(response);
    return (await response.json()) as WorkspaceSnapshot;
  },
  createBranch: (body: CreateBranchRequest) => postJson<WorkspaceSnapshot>('/branches', body),
  assert: (body: AssertRequest) => postJson<WorkspaceSnapshot>('/assert', body),
  signoff: (body: SignoffRequest) => postJson<WorkspaceSnapshot>('/signoff', body),
  merge: (body: MergeRequest) => postJson<MergeResponse>('/merge', body),
  reset: () => postJson<WorkspaceSnapshot>('/reset', {}),
  prompt: (body: PromptRequest, onEvent: (event: StreamEvent) => void, signal?: AbortSignal) =>
    postStream('/prompt', body, onEvent, signal),
  comment: (body: CommentRequest, onEvent: (event: StreamEvent) => void, signal?: AbortSignal) =>
    postStream('/comment', body, onEvent, signal),
};
