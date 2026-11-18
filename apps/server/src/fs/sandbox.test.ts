import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture, type Fixture } from './test.fixture.ts';
import { buildAllowlist, NOT_FOUND, Sandbox } from './sandbox.ts';

let fx: Fixture;
let sb: Sandbox;

beforeAll(async () => {
  fx = createFixture();
  sb = new Sandbox(await buildAllowlist(fx.content));
});
afterAll(() => fx.cleanup());

/** Erwartet eine erfolgreiche Auflösung und gibt den simulierten Pfad zurück. */
async function ok(cwd: string, input: string): Promise<string> {
  const r = await sb.resolve(cwd, input);
  if (!r.ok) throw new Error(`erwartet ok für ${cwd} + ${input}, bekam: ${r.error}`);
  return r.path;
}
async function denied(cwd: string, input: string): Promise<string> {
  const r = await sb.resolve(cwd, input);
  expect(r.ok, `${cwd} + ${JSON.stringify(input)}`).toBe(false);
  return r.ok ? '' : r.error;
}

describe('allowlist', () => {
  it('contains the content root and every real path inside', async () => {
    const list = await buildAllowlist(fx.content);
    expect(list.has(list.root)).toBe(true);
    expect(list.has(join(list.root, 'docs', 'deep', 'b.txt'))).toBe(true);
    expect(list.has(join(list.root, '.hidden'))).toBe(true);
  });

  it('never contains paths outside the content root', async () => {
    const list = await buildAllowlist(fx.content);
    for (const p of list.paths()) expect(p.startsWith(list.root)).toBe(true);
    expect([...list.paths()].some((p) => p.includes('secret'))).toBe(false);
  });

  it('does not list symlinks themselves (only real paths)', async () => {
    const list = await buildAllowlist(fx.content);
    expect(list.has(join(list.root, 'link-out'))).toBe(false);
    expect(list.has(join(list.root, 'link-inside'))).toBe(false);
  });

  it('fails for a missing content directory', async () => {
    await expect(buildAllowlist(join(fx.base, 'nope'))).rejects.toThrow();
  });
});

describe('sandbox.resolve: allowed paths', () => {
  it('resolves relative and absolute simulated paths', async () => {
    expect(await ok('/', '')).toBe('/');
    expect(await ok('/', '.')).toBe('/');
    expect(await ok('/', 'docs')).toBe('/docs');
    expect(await ok('/docs', 'deep/b.txt')).toBe('/docs/deep/b.txt');
    expect(await ok('/docs/deep', '/README.txt')).toBe('/README.txt');
    expect(await ok('/docs/deep', '../a.txt')).toBe('/docs/a.txt');
    expect(await ok('/', 'docs/../docs/./a.txt')).toBe('/docs/a.txt');
    expect(await ok('/', 'docs//a.txt')).toBe('/docs/a.txt');
  });

  it('clamps .. at the simulated root', async () => {
    expect(await ok('/', '..')).toBe('/');
    expect(await ok('/', '../../..')).toBe('/');
    expect(await ok('/docs', '../../../README.txt')).toBe('/README.txt');
  });

  it('maps ~ to the root', async () => {
    expect(await ok('/docs', '~')).toBe('/');
    expect(await ok('/docs', '~/README.txt')).toBe('/README.txt');
  });

  it('follows symlinks that stay inside and keeps the simulated path', async () => {
    expect(await ok('/', 'link-inside')).toBe('/link-inside');
    expect(await ok('/', 'link-dir/deep')).toBe('/link-dir/deep');
    expect(await ok('/', 'chain1')).toBe('/chain1');
  });

  it('handles unicode names', async () => {
    expect(await ok('/', 'ümlaut.txt')).toBe('/ümlaut.txt');
  });

  it('reports the real target type', async () => {
    const r = await sb.resolve('/', 'link-dir');
    expect(r.ok && r.isDir).toBe(true);
  });
});

describe('sandbox.resolve: attacks', () => {
  it('cannot reach host files with absolute paths', async () => {
    await denied('/', '/etc/passwd');
    await denied('/', fx.secret);
    await denied('/', join(fx.secret, 'passwd.txt'));
  });

  it('cannot traverse out with ..', async () => {
    await denied('/', '../secret/passwd.txt');
    await denied('/docs', '../../secret');
    await denied('/', '../../../../../../etc/passwd');
  });

  it('does not decode URL encoding', async () => {
    await denied('/', '%2e%2e/secret');
    await denied('/', '..%2fsecret');
    await denied('/', '%252e%252e%252fsecret');
    await denied('/', '..%c0%afsecret');
  });

  it('rejects null bytes and control characters', async () => {
    expect(await denied('/', 'README.txt\u0000.png')).toBe('Ungültiger Pfad.');
    expect(await denied('/', 'docs\u0000/../../secret')).toBe('Ungültiger Pfad.');
    await denied('/', 'a\u001b[2Jb');
    await denied('/', '‮docs');
  });

  it('rejects backslashes', async () => {
    await denied('/', '..\\secret');
    await denied('/', 'docs\\a.txt');
  });

  it('rejects symlinks pointing outside', async () => {
    await denied('/', 'link-out');
    await denied('/', 'link-out-dir');
    await denied('/', 'link-out-dir/passwd.txt');
    await denied('/', 'abs-out/passwd.txt');
    await denied('/', 'chain-out1');
    await denied('/', 'chain-out1/passwd.txt');
  });

  it('survives symlink loops', async () => {
    await denied('/', 'loop1');
    await denied('/', 'loop1/x');
  });

  it('rejects overlong paths and segments', async () => {
    await denied('/', 'a/'.repeat(600));
    await denied('/', 'x'.repeat(256));
    await denied('/', `${'docs/'.repeat(300)}a.txt`);
  });

  it('rejects files created after the allowlist was built', async () => {
    writeFileSync(join(fx.content, 'late.txt'), 'neu');
    await denied('/', 'late.txt');
  });

  it('gives the same answer for missing and forbidden paths', async () => {
    expect(await denied('/', 'does-not-exist')).toBe(NOT_FOUND);
    expect(await denied('/', 'link-out')).toBe(NOT_FOUND);
    expect(await denied('/', '../secret/passwd.txt')).toBe(NOT_FOUND);
  });

  it('never leaks host paths in errors', async () => {
    for (const input of ['link-out', '../secret', 'loop1', 'abs-out/passwd.txt', '\u0000']) {
      const err = await denied('/', input);
      expect(err).not.toContain(fx.base);
      expect(err).not.toContain('secret');
    }
  });
});

describe('sandbox.resolveCwd', () => {
  it('accepts existing directories and normalizes them', async () => {
    expect(await sb.resolveCwd('/docs')).toEqual({ ok: true, path: '/docs' });
    expect(await sb.resolveCwd('/docs/../docs/deep/')).toEqual({ ok: true, path: '/docs/deep' });
    expect(await sb.resolveCwd('/link-dir')).toEqual({ ok: true, path: '/link-dir' });
  });

  it('rejects a cwd that is missing, a file, outside or malformed', async () => {
    expect((await sb.resolveCwd('/nope')).ok).toBe(false);
    expect((await sb.resolveCwd('/README.txt')).ok).toBe(false);
    expect((await sb.resolveCwd('/link-out-dir')).ok).toBe(false);
    expect((await sb.resolveCwd('docs')).ok).toBe(false);
    expect((await sb.resolveCwd('/docs\u0000')).ok).toBe(false);
    expect((await sb.resolveCwd(`/${'a'.repeat(2000)}`)).ok).toBe(false);
  });

  it('clamps traversal in the cwd itself', async () => {
    expect(await sb.resolveCwd('/../../..')).toEqual({ ok: true, path: '/' });
  });
});
