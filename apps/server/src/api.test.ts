import type { FastifyInstance } from 'fastify';
import type { Snapshot } from '@maxim-os/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from './app.ts';
import { buildSnapshot } from './snapshot.ts';
import { createFixture, type Fixture } from './test.fixture.ts';

let fx: Fixture;
let snapshot: Snapshot;
let app: FastifyInstance | undefined;

beforeAll(async () => {
  fx = createFixture();
  snapshot = await buildSnapshot(fx.content);
});
afterAll(() => fx.cleanup());
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(options: Partial<AppOptions> = {}): Promise<FastifyInstance> {
  app = await buildApp({ logger: false, snapshot, ...options });
  return app;
}

describe('GET /api/fs', () => {
  it('returns the snapshot with an ETag and revalidation headers', async () => {
    const a = await start();
    const res = await a.inject({ method: 'GET', url: '/api/fs' });
    expect(res.statusCode).toBe(200);
    expect(res.json<Snapshot>()).toEqual(snapshot);
    expect(res.headers.etag).toBe(`"${snapshot.version}"`);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).not.toContain(fx.base);
  });

  it('answers 304 when the client already has this version', async () => {
    const a = await start();
    const res = await a.inject({
      method: 'GET',
      url: '/api/fs',
      headers: { 'if-none-match': `"${snapshot.version}"` },
    });
    expect(res.statusCode).toBe(304);
    expect(res.body).toBe('');
  });

  it('is not available without a snapshot', async () => {
    const a = await start({ snapshot: undefined });
    expect((await a.inject({ method: 'GET', url: '/api/fs' })).statusCode).toBe(404);
  });
});

describe('no input-processing endpoints', () => {
  it('has no command or completion endpoints any more', async () => {
    const a = await start();
    for (const url of ['/api/command', '/api/complete']) {
      const res = await a.inject({
        method: 'POST',
        url,
        payload: { cwd: '/', name: 'ls', args: [] },
      });
      expect(res.statusCode, url).toBe(404);
    }
  });
});

describe('hardening', () => {
  it('sets security headers and allows GitHub for connect-src only', async () => {
    const a = await start();
    const res = await a.inject({ method: 'GET', url: '/api/health' });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self' https://api.github.com");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('has a global rate limit for the API that proxy headers cannot bypass', async () => {
    const a = await start({ rateLimit: { max: 3, windowMs: 60_000 } });
    const send = (ip: string) =>
      a.inject({
        method: 'GET',
        url: '/api/fs',
        remoteAddress: ip,
        headers: { 'x-forwarded-for': `1.2.3.${ip.slice(-1)}` },
      });
    expect((await send('10.0.0.1')).statusCode).toBe(200);
    expect((await send('10.0.0.2')).statusCode).toBe(200);
    expect((await send('10.0.0.3')).statusCode).toBe(200);
    const limited = await send('10.0.0.4');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'Zu viele Anfragen. Bitte kurz warten.' });
  });
});
