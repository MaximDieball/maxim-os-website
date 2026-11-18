/**
 * Security-Review MVP 2 (#26): gezielte Angriffe auf Pfad-Validator, Dateisystem-Commands
 * und API. Grüne Tests sind Regressionstests für korrekt abgewehrte Angriffe. Tests mit
 * `[FINDING-n]` beschreiben das sichere Sollverhalten für die gefundenen Lücken; sie waren
 * zuerst rot und sind seit den Fixes für #26 grün (siehe docs/security-review-mvp2.md).
 */
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { CommandResult, CompleteResponse, TreeNode } from '@maxim-os/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from './app.ts';
import { OUTPUT_LIMITS } from './fs/commands.ts';
import { buildAllowlist, NOT_FOUND, Sandbox } from './fs/sandbox.ts';
import { createFixture, type Fixture } from './fs/test.fixture.ts';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
const OSC_NAME = 'osc\u001b]0;pwned\u0007.txt';
const BIDI_NAME = 'txt.‮exe';
const NOT_FOUND_SUFFIX = `: ${NOT_FOUND}`;
const HIGH_LIMITS = { perClient: 1_000_000, global: 1_000_000, windowMs: 60_000 };

let fx: Fixture;
let sandbox: Sandbox;
let app: FastifyInstance;
let extra: FastifyInstance | undefined;

/**
 * Zusätzliche Fixture-Dateien (vor dem Bau der Allowlist):
 *   rootlink        -> .                  (Wurzel selbst, Physisch-".." wäre außerhalb)
 *   docs/escape     -> ../..              (Basis außerhalb)
 *   docs/deep/back  -> ../../../secret    (Rückweg nach außen)
 *   via-dir         -> link-dir/deep      (Symlink auf Symlink-Ordner, erlaubt)
 *   cyc/up          -> ..                 (Zyklus innerhalb)
 *   long0 .. long44                        (Kette über das ELOOP-Limit)
 *   .hiddendir/x.txt, many/ (600 Dateien), osc.txt (Escape-Inhalt), exact.txt (64 KiB)
 *   swapdir/, swapfile.txt                 (werden nach dem Start durch Symlinks ersetzt)
 */
function extendFixture(content: string): void {
  writeFileSync(join(content, OSC_NAME), 'x');
  writeFileSync(join(content, BIDI_NAME), 'x');
  writeFileSync(join(content, 'back\\slash.txt'), 'x');
  symlinkSync('.', join(content, 'rootlink'));
  symlinkSync('../..', join(content, 'docs', 'escape'));
  symlinkSync('../../../secret', join(content, 'docs', 'deep', 'back'));
  symlinkSync('link-dir/deep', join(content, 'via-dir'));
  mkdirSync(join(content, 'cyc'));
  symlinkSync('..', join(content, 'cyc', 'up'));
  symlinkSync('docs/a.txt', join(content, 'long44'));
  for (let i = 0; i < 44; i++) symlinkSync(`long${i + 1}`, join(content, `long${i}`));
  mkdirSync(join(content, '.hiddendir'));
  writeFileSync(join(content, '.hiddendir', 'x.txt'), 'hidden\n');
  mkdirSync(join(content, 'many'));
  for (let i = 0; i < 600; i++) {
    writeFileSync(join(content, 'many', `f${String(i).padStart(3, '0')}.txt`), '');
  }
  writeFileSync(
    join(content, 'osc.txt'),
    [
      'a\u001b]0;title\u0007',
      'b\u001b]8;;https://evil.example\u0007link\u001b]8;;\u001b\\',
      'c\u009b2J\u009d0;t\u009c',
      'd\u001bP+q544e\u001b\\',
      'e\u001b[?1049h\u001b(0\u001b#8',
      'f\u001b]52;c;cHduZWQ=\u0007',
      '',
    ].join('\n'),
  );
  writeFileSync(join(content, 'exact.txt'), 'y'.repeat(OUTPUT_LIMITS.catBytes));
  mkdirSync(join(content, 'swapdir'));
  writeFileSync(join(content, 'swapdir', 'ok.txt'), 'ok');
  writeFileSync(join(content, 'swapfile.txt'), 'ok');
}

beforeAll(async () => {
  fx = createFixture();
  extendFixture(fx.content);
  sandbox = new Sandbox(await buildAllowlist(fx.content));
  app = await buildApp({ logger: false, sandbox, rateLimit: HIGH_LIMITS });
});
afterAll(async () => {
  await app.close();
  fx.cleanup();
});
afterEach(async () => {
  await extra?.close();
  extra = undefined;
});

async function startExtra(options: Partial<AppOptions>): Promise<FastifyInstance> {
  extra = await buildApp({ logger: false, sandbox, ...options });
  return extra;
}

/** Prüft jede Antwort auf Lecks: Hostpfade, Geheimnisse, Stacktraces. */
function assertNoLeak(body: string): void {
  expect(body).not.toContain(fx.base);
  expect(body).not.toContain(sandbox.allowlist.root);
  expect(body).not.toContain('TOP SECRET');
  expect(body).not.toMatch(/\n\s+at /);
}

async function cmd(name: string, args: string[] = [], cwd = '/'): Promise<CommandResult> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/command',
    payload: { cwd, name, args },
  });
  expect(res.statusCode, res.body).toBe(200);
  // Hostpfade dürfen nur erscheinen, wenn der Angreifer sie selbst als Argument geschickt hat.
  if (!args.some((a) => a.includes(fx.base))) assertNoLeak(res.body);
  else expect(res.body).not.toContain('TOP SECRET');
  return res.json<CommandResult>();
}

async function complete(partial: string, cwd = '/'): Promise<string[]> {
  const res = await app.inject({ method: 'POST', url: '/api/complete', payload: { cwd, partial } });
  expect(res.statusCode, res.body).toBe(200);
  assertNoLeak(res.body);
  return res.json<CompleteResponse>().candidates;
}

function errorOf(r: CommandResult): string {
  if (r.kind !== 'error') throw new Error(`erwartet Fehler, bekam ${JSON.stringify(r)}`);
  return r.message;
}

async function notFound(name: string, args: string[], cwd = '/'): Promise<void> {
  const message = errorOf(await cmd(name, args, cwd));
  expect(message, `${name} ${JSON.stringify(args)}`).toMatch(new RegExp(`${NOT_FOUND_SUFFIX}$`));
}

async function invalid(name: string, args: string[], cwd = '/'): Promise<void> {
  const r = await cmd(name, args, cwd);
  expect(r.kind, `${name} ${JSON.stringify(args)}`).toBe('error');
}

function treeNames(node: TreeNode): string[] {
  return [node.name, ...(node.children ?? []).flatMap(treeNames)];
}

async function rawPost(url: string, body: string | Buffer, contentType = 'application/json') {
  const res = await app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': contentType },
    payload: body,
  });
  assertNoLeak(res.body);
  return res;
}

describe('traversal and symlinks', () => {
  it('clamps .. at the root for every server command', async () => {
    for (const name of ['ls', 'tree', 'cd']) {
      await notFound(name, ['../secret']);
      await notFound(name, ['docs/../../secret'], '/docs/deep');
    }
    await notFound('cat', ['../../../../secret/passwd.txt']);
    await notFound('cat', ['/../secret/passwd.txt'], '/docs');
    await notFound('cat', ['~/../secret/passwd.txt']);
  });

  it('resolves .. lexically before realpath (symlink to the root, then ..)', async () => {
    // Physisch wäre <content>/rootlink/../secret der Ordner außerhalb.
    await notFound('cat', ['rootlink/../secret/passwd.txt']);
    await notFound('ls', ['rootlink/..//../secret']);
    expect(await cmd('cd', ['rootlink'])).toEqual({ kind: 'cd', cwd: '/rootlink' });
    await notFound('cat', ['../secret/passwd.txt'], '/rootlink');
    expect(await cmd('cd', ['..'], '/rootlink')).toEqual({ kind: 'cd', cwd: '/' });
    await notFound('cat', ['link-dir/../../secret/passwd.txt']);
    await notFound('ls', ['../../secret'], '/link-dir/deep');
  });

  it('re-validates a client cwd that walks through symlinks', async () => {
    for (const cwd of ['/rootlink/../secret', '/docs/escape', '/docs/deep/back', '/abs-out']) {
      const r = await cmd('ls', [], cwd);
      expect(r).toMatchObject({ kind: 'error', resetCwd: true });
    }
    expect(await cmd('pwd', [], '/rootlink/../docs')).toEqual({ kind: 'pwd', cwd: '/docs' });
  });

  it('denies symlinks with a way back outside (inside dir, parent of root)', async () => {
    await notFound('ls', ['docs/escape']);
    await notFound('cat', ['docs/escape/secret/passwd.txt']);
    await notFound('cat', ['docs/deep/back/passwd.txt']);
    await notFound('cd', ['back'], '/docs/deep');
    await notFound('cat', ['link-dir/deep/back/passwd.txt']);
    await notFound('cat', ['via-dir/back/passwd.txt']);
  });

  it('follows chains of inside symlinks but fails closed on overlong chains', async () => {
    expect(await cmd('cd', ['via-dir'])).toEqual({ kind: 'cd', cwd: '/via-dir' });
    expect(await cmd('cat', ['chain1'])).toMatchObject({ kind: 'cat', text: 'A\n' });
    await notFound('cat', ['long0']);
    await notFound('cat', ['loop1']);
    await notFound('ls', ['loop2/..//loop1/x']);
  });

  it('terminates tree on symlink cycles and never leaves the content folder', async () => {
    const all = await cmd('tree', ['-L', '5']);
    if (all.kind !== 'tree') throw new Error(all.kind);
    expect(all.truncated).toBe(true);
    expect(treeNames(all.root)).not.toContain('escape');
    expect(treeNames(all.root)).not.toContain('back');
  });

  it('[FINDING-3] tree never returns more nodes than the node limit', async () => {
    for (const target of ['cyc', '.']) {
      const r = await cmd('tree', ['-L', '5', target]);
      if (r.kind !== 'tree') throw new Error(r.kind);
      expect(r.dirs + r.files, target).toBeLessThanOrEqual(OUTPUT_LIMITS.treeNodes);
      expect(treeNames(r.root).length - 1, target).toBeLessThanOrEqual(OUTPUT_LIMITS.treeNodes);
    }
  });

  it('pins real paths: swapping entries for outside symlinks after start is denied', async () => {
    const dir = join(fx.content, 'swapdir');
    const file = join(fx.content, 'swapfile.txt');
    expect(await cmd('cat', ['swapdir/ok.txt'])).toMatchObject({ kind: 'cat', text: 'ok' });
    rmSync(dir, { recursive: true });
    rmSync(file);
    symlinkSync(fx.secret, dir);
    symlinkSync(join(fx.secret, 'passwd.txt'), file);
    await notFound('cat', ['swapdir/passwd.txt']);
    await notFound('cat', ['swapfile.txt']);
    await notFound('cd', ['swapdir']);
    expect(await complete('swapdir/')).toEqual([]);
  });
});

describe('absolute paths and encodings', () => {
  it('maps absolute paths onto the simulated root', async () => {
    await notFound('cat', ['/etc/passwd']);
    await notFound('cat', [join(fx.secret, 'passwd.txt')]);
    await notFound('ls', [fx.base]);
    await notFound('cat', [join(sandbox.allowlist.root, 'README.txt')]);
    // Die Fehlermeldung zeigt nur die eigene Eingabe, nie den echten Content-Ordner.
    const own = errorOf(await cmd('cat', ['/x']));
    expect(own).toBe(`cat: /x${NOT_FOUND_SUFFIX}`);
    await notFound('cat', ['//etc/passwd']);
    await notFound('cat', ['/proc/self/environ']);
    await notFound('cat', ['file:///etc/passwd']);
  });

  it('does not decode URL, double or overlong encodings', async () => {
    for (const p of [
      '%2e%2e%2fsecret%2fpasswd.txt',
      '%252e%252e%252fsecret',
      '..%c0%af..%c0%afsecret',
      '%c0%ae%c0%ae/secret',
      '..%u2215secret',
      '&#46;&#46;/secret',
    ]) {
      await notFound('cat', [p]);
    }
  });

  it('treats raw overlong UTF-8 bytes in the body as replacement characters', async () => {
    const head = Buffer.from('{"cwd":"/","name":"cat","args":["');
    const dots = Buffer.from([0xc0, 0xae, 0xc0, 0xae, 0x2f]);
    const tail = Buffer.from('secret/passwd.txt"]}');
    const res = await rawPost('/api/command', Buffer.concat([head, dots, tail]));
    expect([200, 400]).toContain(res.statusCode);
    if (res.statusCode === 200) expect(res.json<CommandResult>().kind).toBe('error');
  });

  it('rejects null bytes and backslashes with a fixed message', async () => {
    for (const p of [
      'README.txt\u0000',
      'docs\u0000/../../secret',
      '..\\secret',
      'back\\slash.txt',
    ]) {
      expect(errorOf(await cmd('cat', [p]))).toMatch(/Ungültiger Pfad\.$/);
    }
    expect(await cmd('ls', [], '/docs\u0000')).toMatchObject({ kind: 'error', resetCwd: true });
    expect(await cmd('ls', [], '/docs\\x')).toMatchObject({ kind: 'error', resetCwd: true });
  });

  it('does not normalize unicode lookalikes (fullwidth dots, NFD, zero-width)', async () => {
    for (const p of [
      '．．/secret/passwd.txt',
      '．．／secret',
      '․․/secret',
      '..∕secret',
      '..⁄secret',
      '.​./secret',
      'READ​ME.txt',
      '﻿README.txt',
      'README.txt‍',
      'ümlaut.txt',
    ]) {
      await notFound('cat', [p]);
    }
    expect(await cmd('cat', ['ümlaut.txt'])).toMatchObject({ kind: 'cat' });
  });

  it('rejects bidi overrides and control characters in paths', async () => {
    for (const p of ['‮docs', 'docs⁦', 'a\u001b[2Jb', 'a\u009bb', 'a\u007fb']) {
      expect(errorOf(await cmd('ls', [p]))).toMatch(/Ungültiger Pfad\.$/);
    }
  });

  it('rejects overlong paths and segments without a host error', async () => {
    await invalid('cat', ['x'.repeat(256)]);
    await invalid('cat', [`${'a/'.repeat(127)}b`]);
    await invalid('ls', [], `/${'a'.repeat(1023)}`);
    await invalid('ls', [], `/${'x'.repeat(300)}`);
  });
});

describe('information leaks and existence oracles', () => {
  it('answers missing and forbidden targets identically for every command', async () => {
    const targets = [
      'missing',
      'link-out',
      'link-out-dir',
      'abs-out',
      'chain-out1',
      'loop1',
      'long0',
      '../secret',
      'docs/escape',
      'README.txt/x',
    ];
    for (const name of ['ls', 'cat', 'cd', 'tree']) {
      const messages = new Set<string>();
      for (const t of targets) {
        messages.add(errorOf(await cmd(name, [t])).replace(t, '<t>'));
      }
      expect([...messages], name).toEqual([`${name}: <t>${NOT_FOUND_SUFFIX}`]);
    }
  });

  it('does not reveal the type of a forbidden target', async () => {
    // link-out zeigt auf eine Datei, link-out-dir auf einen Ordner: beides "nicht gefunden".
    expect(errorOf(await cmd('cd', ['link-out']))).toBe(`cd: link-out${NOT_FOUND_SUFFIX}`);
    expect(errorOf(await cmd('cat', ['link-out-dir']))).toBe(
      `cat: link-out-dir${NOT_FOUND_SUFFIX}`,
    );
  });

  it('never lists forbidden or unsafe names in ls, tree or complete', async () => {
    const forbidden = ['link-out', 'abs-out', 'chain-out1', 'loop1', 'long0', OSC_NAME, BIDI_NAME];
    const ls = await cmd('ls', ['-la']);
    if (ls.kind !== 'ls') throw new Error(ls.kind);
    const names = ls.entries.map((e) => e.name);
    for (const f of forbidden) expect(names).not.toContain(f);
    expect(names).not.toContain('back\\slash.txt');
    const tree = await cmd('tree', ['-L', '1']);
    expect(JSON.stringify(tree)).not.toMatch(/link-out|abs-out|chain-out|loop|long0|\\\\/);
    expect(treeNames(tree.kind === 'tree' ? tree.root : { name: '', type: 'dir' })).not.toContain(
      OSC_NAME,
    );
    expect(await complete('osc')).toEqual(['osc.txt']);
    expect(await complete('li')).toEqual(['link-dir/', 'link-inside']);
    expect(await complete('long')).not.toContain('long0');
    expect(await complete('abs-out/')).toEqual([]);
    expect(await complete('link-out-dir/')).toEqual([]);
    expect(await complete('loop1/')).toEqual([]);
    expect(await complete('docs/escape/')).toEqual([]);
    expect(await complete('rootlink/../../')).not.toContain('../secret/');
  });

  it('completion never yields control characters, even for crafted partials', async () => {
    for (const partial of ['\u001b', 'osc\u001b', '\u001b]0;x\u0007/', '‮', '\u0000']) {
      for (const c of await complete(partial)) expect(c).not.toMatch(CONTROL);
    }
  });

  it('hides dotfiles unless asked for (by design they are readable)', async () => {
    const ls = await cmd('ls');
    expect(JSON.stringify(ls)).not.toContain('.hiddendir');
    expect(JSON.stringify(await cmd('tree'))).not.toContain('.hiddendir');
    expect(await complete('')).not.toContain('.hiddendir/');
    expect(await complete('.hiddend')).toEqual(['.hiddendir/']);
    expect(await cmd('cat', ['.hiddendir/x.txt'])).toMatchObject({ kind: 'cat' });
  });
});

describe('terminal injection', () => {
  it('strips OSC, DCS, C1 and mode-switch sequences from file contents', async () => {
    const r = await cmd('cat', ['osc.txt']);
    if (r.kind !== 'cat') throw new Error(r.kind);
    expect(r.text).not.toMatch(CONTROL);
    expect(r.text).not.toContain('\u001b');
    for (const line of ['a', 'b', 'c', 'd', 'e', 'f']) {
      expect(r.text.split('\n').some((l) => l.startsWith(line))).toBe(true);
    }
  });

  it('[FINDING-1] error messages never echo control characters from arguments', async () => {
    const cases: [string, string[]][] = [
      ['cat', ['\u001b]0;pwned\u0007']],
      ['cat', ['a\u0000b']],
      ['cd', ['\u009b2J']],
      ['ls', ['-\u001b[2J']],
      ['ls', ['--\u001b]8;;https://evil.example\u0007']],
      ['tree', ['-L', '\u001b[31m']],
      ['tree', ['-L\u001b[5m']],
    ];
    const leaked: string[] = [];
    for (const [name, args] of cases) {
      const message = errorOf(await cmd(name, args));
      if (CONTROL.test(message)) leaked.push(JSON.stringify(message));
    }
    expect(leaked).toEqual([]);
  });
});

describe('flags and arguments (allowlist)', () => {
  it('rejects unknown, long, bare and malformed flags', async () => {
    const cases: [string, string[]][] = [
      ['ls', ['-R']],
      ['ls', ['-la', '-R']],
      ['ls', ['-l=1']],
      ['ls', ['---']],
      ['ls', ['--']],
      ['ls', ['-']],
      ['ls', ['--all']],
      ['ls', ['docs', '-h']],
      ['cat', ['-n', 'README.txt']],
      ['cat', ['README.txt', '-v']],
      ['cd', ['-']],
      ['cd', ['-P', 'docs']],
      ['tree', ['-a']],
      ['tree', ['-l']],
      ['pwd', ['-P']],
      ['ls', ['-__proto__']],
      ['ls', ['-constructor']],
    ];
    for (const [name, args] of cases) {
      const r = await cmd(name, args);
      if (name === 'ls' && args[0] === '--') {
        // "--" allein: keine Operanden, entspricht "ls".
        expect(r.kind).toBe('ls');
        continue;
      }
      expect(r.kind, `${name} ${args.join(' ')}`).toBe('error');
    }
  });

  it('accepts only small decimal integers in range for -L', async () => {
    for (const v of ['0', '6', '-1', '1e1', '0x2', '2.5', '５', '٣', ' 2', '2 ', '', 'L']) {
      expect(errorOf(await cmd('tree', ['-L', v])), v).toMatch(/^tree: -L/);
    }
    expect(errorOf(await cmd('tree', ['-L', '9'.repeat(30)]))).toMatch(/^tree: -L/);
    expect(errorOf(await cmd('tree', ['-L']))).toMatch(/^tree: -L/);
    expect(errorOf(await cmd('tree', ['-LL']))).toMatch(/^tree: -L/);
    expect(errorOf(await cmd('tree', ['-L', '__proto__']))).toMatch(/^tree: -L/);
    expect((await cmd('tree', ['-L', '005'])).kind).toBe('tree');
    expect((await cmd('tree', ['-L2', 'docs'])).kind).toBe('tree');
    expect((await cmd('tree', ['docs', '-L', '1'])).kind).toBe('tree');
  });

  it('treats everything after -- as operands and enforces operand counts', async () => {
    await notFound('ls', ['--', '-l']);
    await notFound('cat', ['--', '-n']);
    expect(errorOf(await cmd('ls', ['docs', 'docs']))).toBe('ls: zu viele Argumente');
    expect(errorOf(await cmd('cat', ['--']))).toBe('cat: Datei fehlt');
    expect(errorOf(await cmd('pwd', ['x']))).toBe('pwd: zu viele Argumente');
  });

  it('treats prototype keys as plain names (command, path, operand)', async () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'LS', 'ls ']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/command',
        payload: { cwd: '/', name, args: [] },
      });
      expect(res.statusCode, name).toBe(400);
      expect(res.json()).toEqual({ error: 'Ungültige Anfrage.' });
    }
    for (const p of ['__proto__', 'constructor', 'prototype', '__proto__/x']) {
      await notFound('cat', [p]);
    }
    await invalid('ls', [], '/__proto__');
  });

  it('refuses client-side commands and aliases on the server', async () => {
    for (const name of ['help', 'clear', 'cls', 'snake', 'rm', 'echo', 'sh']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/command',
        payload: { cwd: '/', name, args: [] },
      });
      expect(res.statusCode, name).toBe(400);
    }
  });
});

describe('request schema', () => {
  const GENERIC = { error: 'Ungültige Anfrage.' };

  it('rejects wrong types, extra keys and too many arguments', async () => {
    for (const payload of [
      { cwd: '/', name: 'ls', args: [], __proto__x: 1 },
      { cwd: '/', name: 'ls', args: null },
      { cwd: '/', name: 'ls', args: { 0: 'docs', length: 1 } },
      { cwd: '/', name: ['ls'], args: [] },
      { cwd: ['/'], name: 'ls', args: [] },
      { cwd: '', name: 'ls', args: [] },
      { cwd: 'docs', name: 'ls', args: [] },
      { cwd: '/', name: '', args: [] },
      { cwd: '/', name: 'ls', args: Array.from({ length: 16 }, () => 'a') },
      { cwd: '/', name: 'ls', args: ['x'.repeat(257)] },
      { cwd: '/', name: 'x'.repeat(33), args: [] },
      'ls',
      null,
    ]) {
      const res = await rawPost('/api/command', JSON.stringify(payload));
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual(GENERIC);
    }
    const res = await rawPost('/api/complete', JSON.stringify({ cwd: '/', partial: 1 }));
    expect(res.statusCode).toBe(400);
  });

  it('rejects prototype pollution keys in JSON bodies', async () => {
    for (const body of [
      '{"cwd":"/","name":"ls","args":[],"__proto__":{"polluted":1}}',
      '{"cwd":"/","name":"ls","args":[],"constructor":{"prototype":{"polluted":1}}}',
      '{"cwd":"/","partial":"","__proto__":{"isAdmin":true}}',
    ]) {
      const url = body.includes('partial') ? '/api/complete' : '/api/command';
      const res = await rawPost(url, body);
      expect(res.statusCode, body).toBe(400);
      expect(res.json()).toEqual(GENERIC);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('resolves duplicate JSON keys consistently (last wins, still validated)', async () => {
    const smuggle = await rawPost('/api/command', '{"cwd":"/","name":"ls","name":"rm","args":[]}');
    expect(smuggle.statusCode).toBe(400);
    const cwd = await rawPost(
      '/api/command',
      '{"cwd":"/docs","cwd":"/link-out-dir","name":"ls","args":[]}',
    );
    expect(cwd.json()).toMatchObject({ kind: 'error', resetCwd: true });
  });

  it('rejects other content types and malformed JSON generically', async () => {
    const body = JSON.stringify({ cwd: '/', name: 'ls', args: [] });
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const res = await rawPost('/api/command', body, type);
      expect(res.statusCode, type).toBe(400);
      expect(res.json()).toEqual(GENERIC);
    }
    for (const bad of ['{', '{"cwd":"/",}', '\u0000', '[1,2', '{"a":' + '['.repeat(2000)]) {
      const res = await rawPost('/api/command', bad);
      expect(res.statusCode, bad.slice(0, 20)).toBe(400);
      expect(res.json()).toEqual(GENERIC);
    }
  });

  it('rejects very large bodies before parsing', async () => {
    const big = JSON.stringify({ cwd: '/', name: 'ls', args: ['x'.repeat(1024 * 1024)] });
    const res = await rawPost('/api/command', big);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(GENERIC);
  });

  it('does not expose the API via other methods', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH'] as const) {
      const res = await app.inject({ method, url: '/api/command' });
      expect(res.statusCode, method).toBe(404);
      assertNoLeak(res.body);
    }
  });
});

describe('resource limits', () => {
  it('caps ls, tree and completion output for large directories', async () => {
    const ls = await cmd('ls', ['many']);
    if (ls.kind !== 'ls') throw new Error(ls.kind);
    expect(ls.entries.length).toBeLessThanOrEqual(OUTPUT_LIMITS.lsEntries);
    const tree = await cmd('tree', ['many']);
    if (tree.kind !== 'tree') throw new Error(tree.kind);
    expect(tree.files).toBeLessThanOrEqual(OUTPUT_LIMITS.treeNodes);
    expect(tree.truncated).toBe(true);
    expect((await complete('many/')).length).toBeLessThanOrEqual(OUTPUT_LIMITS.completions);
  });

  it('enforces the cat size limit exactly', async () => {
    const ok = await cmd('cat', ['exact.txt']);
    expect(ok.kind === 'cat' && ok.text.length).toBe(OUTPUT_LIMITS.catBytes);
    expect(errorOf(await cmd('cat', ['big.txt']))).toContain('zu groß');
  });
});

describe('rate limits', () => {
  const pwd = { cwd: '/', name: 'pwd', args: [] };

  it('ignores X-Forwarded-For and similar headers for the per-client limit', async () => {
    const a = await startExtra({ rateLimit: { perClient: 2, global: 1000, windowMs: 60_000 } });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await a.inject({
        method: 'POST',
        url: '/api/command',
        headers: {
          'x-forwarded-for': `203.0.113.${i}`,
          'x-real-ip': `198.51.100.${i}`,
          forwarded: `for=192.0.2.${i}`,
        },
        payload: pwd,
      });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([200, 200, 429, 429]);
  });

  it('also limits /api/complete', async () => {
    const a = await startExtra({ rateLimit: { perClient: 1, global: 1000, windowMs: 60_000 } });
    const send = () =>
      a.inject({ method: 'POST', url: '/api/complete', payload: { cwd: '/', partial: '' } });
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(429);
  });

  it('[FINDING-2] a single client cannot use up the global budget with rejected requests', async () => {
    const a = await startExtra({ rateLimit: { perClient: 2, global: 5, windowMs: 60_000 } });
    const send = (ip: string) =>
      a.inject({ method: 'POST', url: '/api/command', remoteAddress: ip, payload: pwd });
    // Client A schickt 10 Anfragen, nur 2 sind erlaubt (Rest 429 pro Client).
    for (let i = 0; i < 10; i++) await send('10.0.0.1');
    // Client B hat noch nie angefragt; global wurden erst 2 Anfragen bedient.
    expect((await send('10.0.0.2')).statusCode).toBe(200);
  });
});

describe('static files', () => {
  it('cannot read files outside the public folder or dotfiles', async () => {
    const pub = join(fx.base, 'public');
    mkdirSync(pub);
    writeFileSync(join(pub, 'index.html'), '<!doctype html><title>ok</title>');
    writeFileSync(join(pub, '.env'), 'ENVSECRET');
    const a = await startExtra({ publicDir: pub, rateLimit: HIGH_LIMITS });
    expect((await a.inject({ method: 'GET', url: '/' })).body).toContain('<title>ok</title>');
    for (const url of [
      '/../secret/passwd.txt',
      '/%2e%2e/secret/passwd.txt',
      '/%2e%2e%2fsecret%2fpasswd.txt',
      '/..%2fsecret%2fpasswd.txt',
      '/%252e%252e/secret/passwd.txt',
      '/..%5csecret%5cpasswd.txt',
      '/.env',
      '/%2eenv',
      '/index.html%00.png',
      '/index.html/..%2f..%2fsecret/passwd.txt',
    ]) {
      const res = await a.inject({ method: 'GET', url });
      expect(res.statusCode, url).not.toBe(200);
      expect(res.body, url).not.toContain('ENVSECRET');
      assertNoLeak(res.body);
    }
  });
});
