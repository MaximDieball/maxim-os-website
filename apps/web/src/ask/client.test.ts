import { describe, expect, it } from 'vitest';
import { askStream, MSG_OFFLINE } from './client.ts';

const streamOf = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const x of chunks) c.enqueue(new TextEncoder().encode(x));
      c.close();
    },
  });

describe('askStream', () => {
  it('posts the messages and passes the streamed text on', async () => {
    const sent: unknown[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(streamOf(['Hal', 'lo']), { status: 200 });
    }) as unknown as typeof fetch;
    const parts: string[] = [];
    const r = await askStream([{ role: 'user', content: 'Hi' }], (t) => parts.push(t), {
      fetch: fetchFn,
    });
    expect(r).toEqual({ ok: true, text: 'Hallo' });
    expect(parts).toEqual(['Hal', 'lo']);
    expect(sent).toEqual([{ messages: [{ role: 'user', content: 'Hi' }] }]);
  });

  it('uses the friendly message of the server and falls back when offline', async () => {
    const busy = (async () =>
      new Response(JSON.stringify({ error: 'beschäftigt' }), {
        status: 503,
      })) as unknown as typeof fetch;
    expect(await askStream([], () => {}, { fetch: busy })).toEqual({
      ok: false,
      error: 'beschäftigt',
    });
    const down = (async () => {
      throw new Error('net');
    }) as unknown as typeof fetch;
    expect(await askStream([], () => {}, { fetch: down })).toEqual({
      ok: false,
      error: MSG_OFFLINE,
    });
  });
});
