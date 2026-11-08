import { describe, expect, it } from 'vitest';

import type { StreamEvent } from '@/lib/workbench/api-types';

import { createNdjsonDecoder, readNdjsonStream } from './ndjson';

const progress = (message: string): StreamEvent => ({ type: 'progress', branch: 'review/rs334', message });
const line = (e: StreamEvent) => `${JSON.stringify(e)}\n`;

function streamOf(chunks: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
      controller.close();
    },
  });
}

describe('createNdjsonDecoder', () => {
  it('holds an event split across chunks until its newline arrives', () => {
    const d = createNdjsonDecoder();
    const text = line(progress('Screening request'));
    expect(d.push(text.slice(0, 10))).toEqual([]);
    expect(d.push(text.slice(10, 30))).toEqual([]);
    expect(d.push(text.slice(30))).toEqual([progress('Screening request')]);
  });

  it('returns several events from one chunk, in order, keeping the trailing partial', () => {
    const d = createNdjsonDecoder();
    const a = progress('a');
    const b: StreamEvent = { type: 'status', branch: 'x', status: 'running' };
    const c = progress('c');
    const tail = line(c);
    expect(d.push(line(a) + line(b) + tail.slice(0, 5))).toEqual([a, b]);
    expect(d.push(tail.slice(5))).toEqual([c]);
  });

  it('drops blank, malformed and untyped lines without ending the stream', () => {
    const d = createNdjsonDecoder();
    const out = d.push(`\n{not json\n${JSON.stringify({ no: 'type' })}\n  \r\n${line(progress('ok'))}`);
    expect(out).toEqual([progress('ok')]);
  });

  it('flush returns a final event that had no trailing newline', () => {
    const d = createNdjsonDecoder();
    expect(d.push(JSON.stringify(progress('last')))).toEqual([]);
    expect(d.flush()).toEqual([progress('last')]);
    expect(d.flush()).toEqual([]);
  });
});

describe('readNdjsonStream', () => {
  it('decodes events split across byte chunks, including a split multi-byte character', async () => {
    const e1 = progress('Calling gemini-4-argon…');
    const e2 = progress('β-globin done');
    const bytes = new TextEncoder().encode(line(e1) + JSON.stringify(e2));
    const ellipsis = new TextEncoder().encode(line(e1)).indexOf(0xe2);
    const chunks = [bytes.slice(0, ellipsis + 1), bytes.slice(ellipsis + 1, ellipsis + 40), bytes.slice(ellipsis + 40)];

    const events: StreamEvent[] = [];
    await readNdjsonStream(streamOf(chunks), (e) => events.push(e));
    expect(events).toEqual([e1, e2]);
  });

  it('delivers many events from a single chunk', async () => {
    const all = [progress('1'), progress('2'), progress('3')];
    const events: StreamEvent[] = [];
    await readNdjsonStream(streamOf([all.map(line).join('')]), (e) => events.push(e));
    expect(events).toEqual(all);
  });
});
