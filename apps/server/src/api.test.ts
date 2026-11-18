import type { FastifyInstance } from 'fastify';
import type { CommandResult, CompleteResponse } from '@maxim-os/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from './app.ts';
import { createFixture, type Fixture } from './fs/test.fixture.ts';
import { buildAllowlist, Sandbox } from './fs/sandbox.ts';

let fx: Fixture;
let sandbox: Sandbox;
let app: FastifyInstance | undefined;

beforeAll(async () => {
  fx = createFixture();
  sandbox = new Sandbox(await buildAllowlist(fx.content));
});
afterAll(() => fx.cleanup());
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(options: Partial<AppOptions> = {}): Promise<FastifyInstance> {
  app = await buildApp({ logger: false, sandbox, ...options });
  return app;
}

async function cmd(name: string, args: string[] = [], cwd = '/'): Promise<CommandResult> {
  const a = app ?? (await start());
  const res = await a.inject({ method: 'POST', url: '/api/command', payload: { cwd, name, args } });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.body).not.toContain(fx.base);
  return res.json<CommandResult>();
}

function errorOf(r: CommandResult): string {
  if (r.kind !== 'error') throw new Error(`erwartet Fehler, bekam ${r.kind}`);
  return r.message;
}

describe('ls', () => {
  it('lists visible entries and hides forbidden symlinks and dotfiles', async () => {
    const r = await cmd('ls');
    if (r.kind !== 'ls') throw new Error(r.kind);
    const names = r.entries.map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining(['README.txt', 'docs', 'link-inside', 'link-dir']),
    );
    expect(names).toContain('ümlaut.txt');
    for (const hidden of [
      'link-out',
      'link-out-dir',
      'chain-out1',
      'loop1',
      'abs-out',
      '.hidden',
    ]) {
      expect(names).not.toContain(hidden);
    }
    expect(r.entries.find((e) => e.name === 'link-dir')?.type).toBe('dir');
    expect([...names].sort()).toEqual(names);
  });

  it('shows dotfiles, . and .. with -a', async () => {
    const r = await cmd('ls', ['-a']);
    if (r.kind !== 'ls') throw new Error(r.kind);
    expect(r.entries.map((e) => e.name)).toEqual(expect.arrayContaining(['.', '..', '.hidden']));
  });

  it('returns size and time with -l (also -la)', async () => {
    const r = await cmd('ls', ['-la', 'docs']);
    if (r.kind !== 'ls') throw new Error(r.kind);
    expect(r.long).toBe(true);
    const a = r.entries.find((e) => e.name === 'a.txt')!;
    expect(a.size).toBe(2);
    expect(Number.isNaN(Date.parse(a.mtime))).toBe(false);
  });

  it('rejects other flags and bad paths', async () => {
    expect(errorOf(await cmd('ls', ['-R']))).toBe('ls: unbekannte Option: -R');
    expect(errorOf(await cmd('ls', ['--color']))).toContain('unbekannte Option');
    expect(errorOf(await cmd('ls', ['../secret']))).toContain('nicht gefunden');
    expect(errorOf(await cmd('ls', ['link-out-dir']))).toContain('nicht gefunden');
  });

  it('lists a single file', async () => {
    const r = await cmd('ls', ['README.txt']);
    expect(r.kind === 'ls' && r.entries.map((e) => e.name)).toEqual(['README.txt']);
  });
});

describe('cd and pwd', () => {
  it('changes into allowed directories', async () => {
    expect(await cmd('cd', ['docs'])).toEqual({ kind: 'cd', cwd: '/docs' });
    expect(await cmd('cd', ['deep'], '/docs')).toEqual({ kind: 'cd', cwd: '/docs/deep' });
    expect(await cmd('cd', ['..'], '/docs')).toEqual({ kind: 'cd', cwd: '/' });
    expect(await cmd('cd', [], '/docs')).toEqual({ kind: 'cd', cwd: '/' });
    expect(await cmd('cd', ['link-dir'])).toEqual({ kind: 'cd', cwd: '/link-dir' });
  });

  it('refuses files, forbidden and missing directories', async () => {
    expect(errorOf(await cmd('cd', ['README.txt']))).toContain('Kein Ordner');
    expect(errorOf(await cmd('cd', ['link-out-dir']))).toContain('nicht gefunden');
    // ".." endet an der simulierten Wurzel, statt auszubrechen.
    expect(await cmd('cd', ['../../..'], '/docs')).toEqual({ kind: 'cd', cwd: '/' });
  });

  it('prints the simulated working directory', async () => {
    expect(await cmd('pwd', [], '/docs/deep')).toEqual({ kind: 'pwd', cwd: '/docs/deep' });
  });

  it('re-validates the cwd sent by the client on every request', async () => {
    expect(errorOf(await cmd('pwd', [], '/nope'))).toContain('Ordner');
    expect(errorOf(await cmd('ls', [], '/link-out-dir'))).toContain('Ordner');
    expect(errorOf(await cmd('ls', [], '/README.txt'))).toContain('Ordner');
  });
});

describe('cat', () => {
  it('prints text files', async () => {
    expect(await cmd('cat', ['README.txt'])).toEqual({
      kind: 'cat',
      path: '/README.txt',
      text: 'Willkommen\n',
    });
    expect(await cmd('cat', ['link-inside'])).toMatchObject({ kind: 'cat', text: 'A\n' });
  });

  it('refuses binaries, directories, big files and forbidden files', async () => {
    expect(errorOf(await cmd('cat', ['binary.bin']))).toContain('keine Textdatei');
    expect(errorOf(await cmd('cat', ['docs']))).toContain('Ist ein Ordner');
    expect(errorOf(await cmd('cat', ['big.txt']))).toContain('zu groß');
    expect(errorOf(await cmd('cat', ['link-out']))).toContain('nicht gefunden');
    expect(errorOf(await cmd('cat', ['/etc/passwd']))).toContain('nicht gefunden');
    expect(errorOf(await cmd('cat', []))).toBe('cat: Datei fehlt');
  });

  it('strips terminal escape sequences and control characters', async () => {
    const r = await cmd('cat', ['ansi.txt']);
    if (r.kind !== 'cat') throw new Error(r.kind);
    // eslint-disable-next-line no-control-regex
    expect(r.text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
    expect(r.text).toContain('rot:');
    expect(r.text).toContain('ende');
  });
});

describe('tree', () => {
  it('shows the tree with counts and respects -L', async () => {
    const r = await cmd('tree', ['docs']);
    if (r.kind !== 'tree') throw new Error(r.kind);
    expect(r.root.children?.map((c) => c.name)).toEqual(['a.txt', 'deep']);
    expect(r.root.children?.[1]?.children?.map((c) => c.name)).toEqual(['b.txt']);
    expect({ dirs: r.dirs, files: r.files }).toEqual({ dirs: 1, files: 2 });

    const flat = await cmd('tree', ['-L', '1', 'docs']);
    if (flat.kind !== 'tree') throw new Error(flat.kind);
    expect(flat.root.children?.[1]?.children).toBeUndefined();
  });

  it('never descends into forbidden links', async () => {
    const r = await cmd('tree', ['-L', '5']);
    expect(JSON.stringify(r)).not.toContain('passwd');
    expect(JSON.stringify(r)).not.toContain('secret');
  });
});

describe('request validation', () => {
  it('rejects unknown, client-side and malformed commands with 400', async () => {
    const a = await start();
    const post = (payload: unknown) =>
      a.inject({ method: 'POST', url: '/api/command', payload: payload as object });
    for (const payload of [
      { cwd: '/', name: 'rm', args: ['-rf', '/'] },
      { cwd: '/', name: 'help', args: [] },
      { cwd: '/', name: 'constructor', args: [] },
      { cwd: '/', name: 'ls', args: [], extra: true },
      { cwd: '/', name: 'ls', args: [1] },
      { name: 'ls', args: [] },
      [],
    ]) {
      const res = await post(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: 'Ungültige Anfrage.' });
    }
  });

  it('rejects oversized bodies', async () => {
    const a = await start();
    const res = await a.inject({
      method: 'POST',
      url: '/api/command',
      payload: { cwd: '/', name: 'ls', args: ['x'.repeat(5000)] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('complete', () => {
  async function complete(partial: string, cwd = '/'): Promise<string[]> {
    const a = app ?? (await start());
    const res = await a.inject({ method: 'POST', url: '/api/complete', payload: { cwd, partial } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(fx.base);
    return res.json<CompleteResponse>().candidates;
  }

  it('completes names in the current and in nested directories', async () => {
    expect(await complete('do')).toEqual(['docs/']);
    expect(await complete('docs/')).toEqual(['docs/a.txt', 'docs/deep/']);
    expect(await complete('d', '/docs')).toEqual(['deep/']);
    expect(await complete('.h')).toEqual(['.hidden']);
  });

  it('offers nothing for forbidden or missing places', async () => {
    expect(await complete('link-o')).toEqual([]);
    expect(await complete('../secret/')).toEqual([]);
    expect(await complete('nope/')).toEqual([]);
    expect(await complete('x', '/nope')).toEqual([]);
  });
});

describe('hardening', () => {
  it('sets security headers', async () => {
    const a = await start();
    const res = await a.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('rate-limits per client and answers without details', async () => {
    const a = await start({ rateLimit: { perClient: 3, global: 100, windowMs: 60_000 } });
    const send = () =>
      a.inject({
        method: 'POST',
        url: '/api/command',
        payload: { cwd: '/', name: 'pwd', args: [] },
      });
    for (let i = 0; i < 3; i++) expect((await send()).statusCode).toBe(200);
    const limited = await send();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'Zu viele Anfragen. Bitte kurz warten.' });
  });

  it('also has a global limit (tunnel hides client IPs)', async () => {
    const a = await start({ rateLimit: { perClient: 100, global: 2, windowMs: 60_000 } });
    const send = (ip: string) =>
      a.inject({
        method: 'POST',
        url: '/api/command',
        remoteAddress: ip,
        payload: { cwd: '/', name: 'pwd', args: [] },
      });
    expect((await send('10.0.0.1')).statusCode).toBe(200);
    expect((await send('10.0.0.2')).statusCode).toBe(200);
    expect((await send('10.0.0.3')).statusCode).toBe(429);
  });
});
