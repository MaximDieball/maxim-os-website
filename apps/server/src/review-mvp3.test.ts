/**
 * Security-Review #66 (MVP 3): Angriffe auf Snapshot-Generator und GET /api/fs.
 * Grüne Tests sind Regressionstests für abgewehrte Angriffe. Tests mit `[FINDING-n]`
 * beschreiben das sichere Sollverhalten und waren rot, solange die Lücke bestand (seit den Fixes zu #66 grün)
 * (siehe docs/security-review-mvp3.md).
 */
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { FsDir, FsNode, Snapshot } from '@maxim-os/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from './app.ts';
import { buildSnapshot } from './snapshot.ts';
import { createFixture, type Fixture } from './test.fixture.ts';

let fx: Fixture;
let snap: Snapshot;
let socket: Server | undefined;
const skipped: { path: string; reason: string }[] = [];
let app: FastifyInstance | undefined;

const child = (dir: FsDir, name: string): FsNode | undefined =>
  dir.children.find((c) => c.name === name);
const names = (dir: FsDir): string[] => dir.children.map((c) => c.name);
const allNames = (dir: FsDir): string[] =>
  dir.children.flatMap((c) => [c.name, ...(c.type === 'dir' ? allNames(c) : [])]);
const count = (dir: FsDir): number =>
  dir.children.reduce((n, c) => n + 1 + (c.type === 'dir' ? count(c) : 0), 0);

/** Namen, die der Generator überspringen muss (Steuerzeichen, Bidi, Backslash). */
const INVALID_NAMES = [
  'ctl\u0001.txt',
  'nl\nname.txt',
  'tab\tname.txt',
  'cr\rname.txt',
  'del\u007f.txt',
  'csi\u009b31m.txt',
  'osc\u001b]0;pwned\u0007.txt',
  'rtl‮txt.exe',
  'iso⁦x⁩.txt',
  'lrm‎.txt',
  'rlm‏.txt',
  'back\\slash.txt',
];

beforeAll(async () => {
  fx = createFixture();
  const c = fx.content;
  for (const name of INVALID_NAMES) writeFileSync(join(c, name), 'x');
  writeFileSync(join(c, 'zero​width.txt'), 'zw');
  writeFileSync(join(c, 'alm؜name.txt'), 'alm');

  // Symlinks tiefer im Baum: nach oben, auf die Wurzel des Hosts, auf sich selbst.
  symlinkSync('../../secret', join(c, 'docs', 'up'));
  symlinkSync('/', join(c, 'docs', 'host-root'));
  symlinkSync('/etc/passwd', join(c, 'docs', 'etc-passwd'));
  symlinkSync('..', join(c, 'docs', 'deep', 'parent'));
  symlinkSync('missing-target', join(c, 'dangling'));

  // Binärerkennung
  const bin = join(c, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'null-at-end.txt'), Buffer.from('hallo\u0000', 'latin1'));
  writeFileSync(join(bin, 'overlong.txt'), Buffer.from([0x61, 0xc0, 0xaf, 0x62]));
  writeFileSync(join(bin, 'surrogate.txt'), Buffer.from([0x61, 0xed, 0xa0, 0x80]));
  writeFileSync(join(bin, 'lone-cont.txt'), Buffer.from([0x61, 0x80]));
  writeFileSync(join(bin, 'truncated.txt'), Buffer.from([0x61, 0xe2, 0x82]));
  writeFileSync(join(bin, 'bom.txt'), Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69]));
  writeFileSync(join(bin, 'emoji.txt'), '🙂\n');
  writeFileSync(join(bin, 'empty.txt'), '');

  // Unix-Socket als Sonderdatei (FIFOs lassen sich ohne Prozessstart nicht anlegen).
  const sockPath = join(c, 'sock');
  socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket!.once('error', reject);
    socket!.listen(sockPath, () => resolve());
  });

  snap = await buildSnapshot(c, { onSkip: (path, reason) => skipped.push({ path, reason }) });
});

afterAll(async () => {
  await new Promise<void>((resolve) => (socket ? socket.close(() => resolve()) : resolve()));
  fx.cleanup();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('review #66: snapshot symlinks and special files', () => {
  it('ignores symlinks at any depth (up, host root, /etc/passwd, self-loop, dangling)', () => {
    const docs = child(snap.root, 'docs') as FsDir;
    expect(names(docs)).toEqual(['a.txt', 'deep']);
    expect(names(child(docs, 'deep') as FsDir)).toEqual(['b.txt']);
    expect(names(snap.root)).not.toContain('dangling');
    const json = JSON.stringify(snap);
    expect(json).not.toContain('TOP SECRET');
    expect(json).not.toContain('root:');
  });

  it('ignores unix sockets', () => {
    expect(names(snap.root)).not.toContain('sock');
  });
});

describe('review #66: snapshot names', () => {
  it('skips names with control characters, C1, bidi overrides/isolates/marks and backslash', () => {
    const all = allNames(snap.root);
    for (const name of INVALID_NAMES) expect(all, JSON.stringify(name)).not.toContain(name);
    // eslint-disable-next-line no-control-regex
    expect(all.filter((n) => /[\u0000-\u001f\u007f-\u009f\\]/.test(n))).toEqual([]);
  });

  it('never reports the invalid name itself or a host path to the skip log', () => {
    expect(skipped.length).toBeGreaterThan(0);
    for (const s of skipped) {
      expect(s.path.startsWith('/') || s.path === '').toBe(true);
      expect(s.path).not.toContain(fx.base);
      // eslint-disable-next-line no-control-regex
      expect(s.path).not.toMatch(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/);
    }
  });

  it('[FINDING-2] skips names with the bidi control U+061C (Arabic letter mark)', () => {
    expect(allNames(snap.root).some((n) => n.includes('؜'))).toBe(false);
  });

  it('[FINDING-1] skips entries whose name is not valid UTF-8 instead of failing', async () => {
    const dir = join(fx.base, 'latin1');
    mkdirSync(dir);
    writeFileSync(join(dir, 'ok.txt'), 'ok');
    // "ä.txt" in Latin-1: Node liest den Namen als "�.txt", der Pfad existiert so nicht.
    writeFileSync(
      Buffer.concat([Buffer.from(`${dir}/`), Buffer.from([0xe4]), Buffer.from('.txt')]),
      'x',
    );
    const result = await buildSnapshot(dir).catch((error: unknown) => error);
    expect(result).not.toBeInstanceOf(Error);
    const root = (result as Snapshot).root;
    expect(names(root)).toEqual(['ok.txt']);
  });
});

describe('review #66: snapshot binary detection', () => {
  const file = (name: string) => child(child(snap.root, 'bin') as FsDir, name);

  it('treats null bytes and invalid UTF-8 (overlong, surrogates, truncated) as binary', () => {
    for (const name of [
      'null-at-end.txt',
      'overlong.txt',
      'surrogate.txt',
      'lone-cont.txt',
      'truncated.txt',
    ]) {
      const node = file(name);
      expect(node, name).toMatchObject({ type: 'file', binary: true });
      expect(node && 'text' in node, name).toBe(false);
    }
  });

  it('keeps valid UTF-8 (BOM, emoji, empty file) as text', () => {
    expect(file('bom.txt')).toMatchObject({ type: 'file', size: 5, text: 'hi' });
    expect(file('emoji.txt')).toMatchObject({ type: 'file', text: '🙂\n' });
    expect(file('empty.txt')).toMatchObject({ type: 'file', size: 0, text: '' });
  });
});

describe('review #66: snapshot limits at the boundary', () => {
  it('keeps a file of exactly fileBytes and drops one byte more', async () => {
    const dir = join(fx.base, 'lim-file');
    mkdirSync(dir);
    writeFileSync(join(dir, 'exact.txt'), 'x'.repeat(10));
    writeFileSync(join(dir, 'over.txt'), 'x'.repeat(11));
    writeFileSync(join(dir, 'over.bin'), Buffer.alloc(11));
    const s = await buildSnapshot(dir, { fileBytes: 10 });
    expect(names(s.root)).toEqual(['exact.txt']);
  });

  it('keeps text up to exactly totalBytes and does not count binaries', async () => {
    const dir = join(fx.base, 'lim-total');
    mkdirSync(dir);
    writeFileSync(join(dir, 'a.txt'), 'x'.repeat(5));
    writeFileSync(join(dir, 'b.bin'), Buffer.alloc(8));
    writeFileSync(join(dir, 'c.txt'), 'x'.repeat(5));
    expect(names((await buildSnapshot(dir, { totalBytes: 10 })).root)).toEqual([
      'a.txt',
      'b.bin',
      'c.txt',
    ]);
    expect(names((await buildSnapshot(dir, { totalBytes: 9 })).root)).toEqual(['a.txt', 'b.bin']);
  });

  it('keeps exactly `entries` entries (dirs and files) and no more', async () => {
    const dir = join(fx.base, 'lim-entries');
    mkdirSync(join(dir, 'd'), { recursive: true });
    writeFileSync(join(dir, 'd', 'x.txt'), 'x');
    writeFileSync(join(dir, 'e.bin'), Buffer.alloc(2));
    writeFileSync(join(dir, 'f.txt'), 'f');
    expect(count((await buildSnapshot(dir, { entries: 4 })).root)).toBe(4);
    expect(count((await buildSnapshot(dir, { entries: 3 })).root)).toBe(3);
    expect(count((await buildSnapshot(dir, { entries: 0 })).root)).toBe(0);
  });

  it('includes entries up to exactly `depth` levels and nothing below', async () => {
    const dir = join(fx.base, 'lim-depth');
    mkdirSync(join(dir, 'l1', 'l2', 'l3'), { recursive: true });
    writeFileSync(join(dir, 'l1', 'f2.txt'), '2');
    writeFileSync(join(dir, 'l1', 'l2', 'f3.txt'), '3');
    const s = await buildSnapshot(dir, { depth: 2 });
    const l1 = child(s.root, 'l1') as FsDir;
    expect(names(l1)).toEqual(['f2.txt', 'l2']);
    expect(child(l1, 'l2')).toMatchObject({ type: 'dir', children: [] });
    expect(JSON.stringify(s)).not.toContain('f3.txt');
  });

  it('uses the SPEC limits by default', async () => {
    const { SNAPSHOT_LIMITS } = await import('@maxim-os/shared');
    expect(SNAPSHOT_LIMITS).toEqual({
      fileBytes: 64 * 1024,
      totalBytes: 2 * 1024 * 1024,
      entries: 2000,
      depth: 12,
    });
  });
});

async function start(options: Partial<AppOptions> = {}): Promise<FastifyInstance> {
  app = await buildApp({ logger: false, snapshot: snap, ...options });
  return app;
}

/** Keine Hostpfade, keine Stacktraces, keine Inhalte von außerhalb. */
function expectNoLeak(body: string): void {
  expect(body).not.toContain(fx.base);
  expect(body).not.toContain('TOP SECRET');
  expect(body).not.toMatch(/\bat .+:\d+:\d+/);
  expect(body).not.toContain('node_modules');
  expect(body).not.toMatch(/ENOENT|EACCES|EISDIR/);
}

describe('review #66: GET /api/fs', () => {
  it('does not process input: query strings and path suffixes change nothing', async () => {
    const a = await start();
    const plain = await a.inject({ method: 'GET', url: '/api/fs' });
    for (const url of ['/api/fs?path=../secret', '/api/fs?cwd=/&name=cat&args=passwd']) {
      const res = await a.inject({ method: 'GET', url });
      expect(res.body, url).toBe(plain.body);
    }
    for (const url of ['/api/fs/../../secret', '/api/fs/docs', '/api/fs%2f..%2fsecret']) {
      const res = await a.inject({ method: 'GET', url });
      expect(res.body, url).not.toContain('TOP SECRET');
      expectNoLeak(res.body);
    }
  });

  it('only allows GET/HEAD on /api/fs; no other input endpoints exist', async () => {
    const a = await start();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      const res = await a.inject({
        method,
        url: '/api/fs',
        payload: method === 'OPTIONS' ? undefined : { path: '/' },
      });
      expect(res.statusCode, method).toBe(404);
      expectNoLeak(res.body);
    }
    for (const url of ['/api/command', '/api/complete', '/api/exec', '/api/fs/write']) {
      for (const method of ['GET', 'POST'] as const) {
        const res = await a.inject({
          method,
          url,
          payload: method === 'POST' ? '{"x":1}' : undefined,
        });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
      }
    }
  });

  it('answers 304 only for the exact ETag and never sends a body with 304', async () => {
    const a = await start();
    const etag = `"${snap.version}"`;
    const exact = await a.inject({
      method: 'GET',
      url: '/api/fs',
      headers: { 'if-none-match': etag },
    });
    expect(exact.statusCode).toBe(304);
    expect(exact.body).toBe('');
    expect(exact.headers.etag).toBe(etag);
    for (const value of ['"0000000000000000"', snap.version, '*', `W/${etag}`, `${etag}x`]) {
      const res = await a.inject({
        method: 'GET',
        url: '/api/fs',
        headers: { 'if-none-match': value },
      });
      expect(res.statusCode, value).toBe(200);
      expect(res.json<Snapshot>()).toEqual(snap);
    }
  });

  it('has a global rate limit that no client-identity header can bypass', async () => {
    const a = await start({ rateLimit: { max: 2, windowMs: 60_000 } });
    const headers = [
      { 'x-forwarded-for': '1.1.1.1' },
      { 'x-real-ip': '2.2.2.2' },
      { forwarded: 'for=3.3.3.3' },
      { 'cf-connecting-ip': '4.4.4.4' },
      { 'true-client-ip': '5.5.5.5' },
      { 'x-client-ip': '6.6.6.6' },
    ];
    const codes: number[] = [];
    for (const [i, h] of headers.entries()) {
      const res = await a.inject({
        method: 'GET',
        url: '/api/fs',
        headers: h,
        remoteAddress: `10.0.0.${i}`,
      });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([200, 200, 429, 429, 429, 429]);
  });

  it('returns errors without stack traces or host paths (bad URL, big body, bad JSON)', async () => {
    const a = await start();
    const cases = [
      await a.inject({ method: 'GET', url: '/%' }),
      await a.inject({ method: 'GET', url: '/api/fs%00' }),
      await a.inject({
        method: 'POST',
        url: '/api/fs',
        headers: { 'content-type': 'application/json' },
        payload: '{"a":',
      }),
      await a.inject({
        method: 'POST',
        url: '/api/health',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ x: 'y'.repeat(10_000) }),
      }),
    ];
    for (const res of cases) {
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expectNoLeak(res.body);
    }
  });
});

describe('review #66: static files', () => {
  it('serves nothing outside the public folder and no dotfiles', async () => {
    const pub = join(fx.base, 'public');
    mkdirSync(pub);
    writeFileSync(join(pub, 'index.html'), '<!doctype html><title>ok</title>');
    writeFileSync(join(pub, '.env'), 'SECRET=1');
    const a = await start({ publicDir: pub });
    expect((await a.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    for (const url of [
      '/../secret/passwd.txt',
      '/%2e%2e/secret/passwd.txt',
      '/..%2fsecret%2fpasswd.txt',
      '/%2e%2e%2f%2e%2e%2fsecret%2fpasswd.txt',
      '/..\\secret\\passwd.txt',
      '/index.html%00.txt',
      '/.env',
      '/%2eenv',
    ]) {
      const res = await a.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBeGreaterThanOrEqual(400);
      expect(res.body, url).not.toContain('SECRET=1');
      expectNoLeak(res.body);
    }
  });
});
