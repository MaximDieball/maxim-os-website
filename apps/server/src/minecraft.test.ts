import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { createMinecraftStatus, toStatus, type Pinger, type RawStatus } from './minecraft.ts';

const RAW: RawStatus = {
  version: { name: 'Paper 1.21.4' },
  players: {
    online: 3,
    max: 20,
    sample: [{ name: 'Maxim_D' }, { name: 'Steve' }, { name: '§cEvil\u001b[31m' }, { name: 'x' }],
  },
  motd: { clean: '  §aWillkommen\u0007 auf   meinem Server \n zweite Zeile ' },
  roundTripLatency: 41.6,
};

function fakePing(results: (RawStatus | Error)[]) {
  const calls: [string, number, number][] = [];
  const ping: Pinger = async (host, port, timeout) => {
    calls.push([host, port, timeout]);
    const r = results[Math.min(calls.length - 1, results.length - 1)]!;
    if (r instanceof Error) throw r;
    return r;
  };
  return { ping, calls };
}

describe('toStatus', () => {
  it('cleans texts, keeps only valid player names and rounds the latency', () => {
    expect(toStatus('mc.example', RAW)).toEqual({
      online: true,
      address: 'mc.example',
      version: 'Paper 1.21.4',
      motd: 'Willkommen auf meinem Server\nzweite Zeile',
      players: { online: 3, max: 20, names: ['Maxim_D', 'Steve'] },
      latencyMs: 42,
    });
  });

  it('copes with missing or broken fields', () => {
    expect(toStatus('a', { players: { online: -1, max: 'x', sample: 'nope' } })).toEqual({
      online: true,
      address: 'a',
      version: undefined,
      motd: undefined,
      players: { online: 0, max: 0, names: [] },
      latencyMs: undefined,
    });
  });
});

describe('createMinecraftStatus', () => {
  it('pings host and port from the config with a timeout', async () => {
    const { ping, calls } = fakePing([RAW]);
    const get = createMinecraftStatus({ host: 'mc.example', port: 25566, ping, timeoutMs: 1234 });
    expect(await get()).toMatchObject({ online: true, address: 'mc.example:25566' });
    expect(calls).toEqual([['mc.example', 25566, 1234]]);
  });

  it('caches for the ttl and shares concurrent pings', async () => {
    let t = 0;
    const { ping, calls } = fakePing([RAW]);
    const get = createMinecraftStatus({
      host: 'h',
      port: 25565,
      ping,
      ttlMs: 10_000,
      now: () => t,
    });
    await Promise.all([get(), get(), get()]);
    expect(calls).toHaveLength(1);
    t = 9_000;
    await get();
    expect(calls).toHaveLength(1);
    t = 11_000;
    await get();
    expect(calls).toHaveLength(2);
  });

  it('reports offline when the ping fails, without details', async () => {
    const errors: unknown[] = [];
    const { ping } = fakePing([new Error('connect ECONNREFUSED 10.0.0.5:25565')]);
    const get = createMinecraftStatus({
      host: 'h',
      port: 25565,
      ping,
      onError: (e) => errors.push(e),
    });
    expect(await get()).toEqual({ online: false, address: 'h' });
    expect(errors).toHaveLength(1);
  });

  it('gives up when the ping hangs', async () => {
    const ping: Pinger = () => new Promise(() => {});
    const get = createMinecraftStatus({ host: 'h', port: 25565, ping, timeoutMs: 10 });
    expect(await get()).toEqual({ online: false, address: 'h' });
  });
});

describe('GET /api/minecraft', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns the status and ignores query parameters', async () => {
    const { ping, calls } = fakePing([RAW]);
    app = await buildApp({
      logger: false,
      minecraft: createMinecraftStatus({ host: 'mc.example', port: 25565, ping }),
    });
    const res = await app.inject({ method: 'GET', url: '/api/minecraft?host=evil.example&port=1' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toMatchObject({ online: true, address: 'mc.example' });
    expect(calls[0]![0]).toBe('mc.example');
  });

  it('does not exist without configuration', async () => {
    app = await buildApp({ logger: false });
    expect((await app.inject({ method: 'GET', url: '/api/minecraft' })).statusCode).toBe(404);
  });
});
