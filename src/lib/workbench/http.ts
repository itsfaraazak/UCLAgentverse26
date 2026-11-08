import type { ApiError, StreamEvent } from './api-types';
import { StoreError } from './store';
import type { StreamRunner } from './service';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof StoreError) return json({ error: err.message } satisfies ApiError, err.status);
  return json({ error: 'Internal error.' } satisfies ApiError, 500);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new StoreError(400, 'Request body must be valid JSON.');
  }
}

/** `application/x-ndjson`: one StreamEvent per line, ending with `done`. */
export function ndjson(run: StreamRunner): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: StreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Client went away; the run continues and is persisted.
          open = false;
        }
      };
      try {
        await run(emit);
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', ...NO_STORE, 'X-Accel-Buffering': 'no' },
  });
}

/** Wrap a handler so thrown StoreErrors become JSON error responses. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    return errorResponse(err);
  }
}
