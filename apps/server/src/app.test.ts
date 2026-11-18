import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('server app', () => {
  it('answers the health check', async () => {
    app = await buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('returns a generic 404 for unknown api routes', async () => {
    app = await buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Nicht gefunden.' });
  });

  it('never leaks stack traces or host paths in errors', async () => {
    app = await buildApp({ logger: false });
    app.get('/api/boom', async () => {
      throw new Error(`secret failure in ${process.cwd()}`);
    });
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Interner Fehler.' });
    expect(res.body).not.toContain(process.cwd());
    expect(res.body).not.toContain('at ');
  });

  it('rejects malformed json without echoing details', async () => {
    app = await buildApp({ logger: false });
    app.post('/api/echo', async () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Ungültige Anfrage.' });
  });

  it('serves the built frontend when a public dir is set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maxim-public-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>MAXIM OS</title>');
    app = await buildApp({ logger: false, publicDir: dir });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('MAXIM OS');
  });
});
