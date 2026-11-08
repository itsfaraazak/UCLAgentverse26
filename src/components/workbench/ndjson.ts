import type { StreamEvent } from '@/lib/workbench/api-types';

/**
 * Incremental NDJSON decoder. Network chunks split lines (and multi-byte
 * characters) arbitrarily, so the trailing partial line is held until the next
 * push. Malformed lines are dropped rather than ending the stream.
 */
export function createNdjsonDecoder() {
  let buffer = '';

  function parseLine(line: string): StreamEvent | null {
    const trimmed = line.trim();
    if (trimmed === '') return null;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string') {
        return value as StreamEvent;
      }
    } catch {
      // fall through
    }
    return null;
  }

  function drain(lines: string[]): StreamEvent[] {
    const events: StreamEvent[] = [];
    for (const line of lines) {
      const event = parseLine(line);
      if (event) events.push(event);
    }
    return events;
  }

  return {
    push(chunk: string): StreamEvent[] {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      return drain(lines);
    },
    flush(): StreamEvent[] {
      const rest = buffer;
      buffer = '';
      return drain([rest]);
    },
  };
}

export async function readNdjsonStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const text = new TextDecoder();
  const decoder = createNdjsonDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of decoder.push(text.decode(value, { stream: true }))) onEvent(event);
    }
    for (const event of decoder.push(text.decode())) onEvent(event);
    for (const event of decoder.flush()) onEvent(event);
  } finally {
    reader.releaseLock();
  }
}
