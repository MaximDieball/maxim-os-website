import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  type CommandRequest,
  type CommandResult,
  type CompleteRequest,
} from '@maxim-os/shared';
import { ApiError, type ServerApi } from './api.ts';
import { formatHelp } from './help.ts';
import { History } from './history.ts';
import { sanitizeInput, stripAnsi } from './text.ts';
import { Shell, type ShellOutput } from './shell.ts';

function fakeOutput(cols = 100) {
  const lines: string[] = [];
  let clears = 0;
  const out: ShellOutput = {
    print: (l) => lines.push(...l.map(stripAnsi)),
    clear: () => {
      clears++;
      lines.length = 0;
    },
    cols: () => cols,
  };
  return { out, lines, clears: () => clears };
}

describe('sanitizeInput', () => {
  it('removes control and escape characters', () => {
    expect(sanitizeInput('he\x1b[31mllo\x07\x00')).toBe('he[31mllo');
    expect(sanitizeInput('a\u009bb‮c')).toBe('abc');
  });
  it('limits the length', () => {
    expect(sanitizeInput('x'.repeat(1000))).toHaveLength(256);
  });
});

describe('History', () => {
  it('navigates up and down', () => {
    const h = new History();
    h.push('one');
    h.push('two');
    expect(h.prev('')).toBe('two');
    expect(h.prev('')).toBe('one');
    expect(h.prev('')).toBe('one');
    expect(h.next()).toBe('two');
    expect(h.next()).toBe('');
  });
  it('restores the draft and skips duplicates and blanks', () => {
    const h = new History();
    h.push('a');
    h.push('a');
    h.push('   ');
    expect(h.entries()).toEqual(['a']);
    expect(h.prev('draft')).toBe('a');
    expect(h.next()).toBe('draft');
  });
  it('is bounded', () => {
    const h = new History(3);
    ['1', '2', '3', '4'].forEach((x) => h.push(x));
    expect(h.entries()).toEqual(['2', '3', '4']);
  });
});

describe('formatHelp', () => {
  it('lists every registry command with description, usage and example', () => {
    const text = formatHelp(COMMANDS, 120).join('\n');
    for (const c of COMMANDS) {
      expect(text).toContain(c.name);
      expect(text).toContain(c.description);
      expect(text).toContain(c.usage);
    }
    expect(text).toContain('cls');
  });
  it('uses a stacked layout that fits narrow screens', () => {
    const lines = formatHelp(COMMANDS, 40);
    for (const l of lines) expect(stripAnsi(l).length).toBeLessThanOrEqual(40);
    expect(lines.join('\n')).toMatch(/Beispiel: +help/);
  });
  it('fits the wide layout into the given width', () => {
    for (const l of formatHelp(COMMANDS, 120)) expect(stripAnsi(l).length).toBeLessThanOrEqual(120);
  });
});

/** Fake-Server: merkt sich Requests und antwortet aus einer Tabelle. */
function fakeApi(results: Record<string, CommandResult> = {}, candidates: string[] = []) {
  const requests: CommandRequest[] = [];
  const completions: CompleteRequest[] = [];
  const api: ServerApi = {
    command: async (req) => {
      requests.push(req);
      return results[req.name] ?? { kind: 'error', message: 'unerwartet' };
    },
    complete: async (req) => {
      completions.push(req);
      return candidates;
    },
  };
  return { api, requests, completions };
}

describe('Shell', () => {
  it('prints help', async () => {
    const { out, lines } = fakeOutput();
    await new Shell(out).execute('help');
    expect(lines.join('\n')).toContain('clear');
    expect(lines.join('\n')).toContain('ls [-l] [-a]');
  });

  it('clears via clear and alias', async () => {
    const { out, clears } = fakeOutput();
    const sh = new Shell(out);
    await sh.execute('clear');
    await sh.execute('cls');
    expect(clears()).toBe(2);
  });

  it('reports unknown commands', async () => {
    const { out, lines } = fakeOutput();
    await new Shell(out).execute('rm -rf /');
    expect(lines).toContain("command not found: rm. Tippe 'help'.");
  });

  it('does not echo escape sequences of unknown commands', async () => {
    const { out, lines } = fakeOutput();
    await new Shell(out).execute('\x1b]0;pwned\x07evil');
    expect(lines.join('')).not.toContain('\x1b');
  });

  it('truncates very long unknown command names', async () => {
    const { out, lines } = fakeOutput();
    await new Shell(out).execute('a'.repeat(200));
    expect(lines[0]!.length).toBeLessThan(80);
  });

  it('rejects unexpected parameters (allowlist)', async () => {
    const { out, lines } = fakeOutput();
    await new Shell(out).execute('clear --force');
    expect(lines).toContain('clear: unbekannte Option: --force');
    await new Shell(out).execute('help me');
    expect(lines).toContain('help: zu viele Argumente');
  });

  it('reports unmatched quotes', async () => {
    const { out, lines } = fakeOutput();
    await new Shell(out).execute('cat "open');
    expect(lines.join(' ')).toContain('Anführungszeichen');
  });

  it('ignores empty input and records history', async () => {
    const { out, lines } = fakeOutput();
    const sh = new Shell(out);
    await sh.execute('   ');
    expect(lines).toEqual([]);
    await sh.execute('help');
    expect(sh.history.entries()).toEqual(['help']);
  });

  it('does not treat prototype keys as commands', async () => {
    const { out, lines } = fakeOutput();
    await new Shell(out).execute('constructor');
    expect(lines).toContain("command not found: constructor. Tippe 'help'.");
  });

  it('sends server commands with the current directory and renders the result', async () => {
    const { out, lines } = fakeOutput();
    const { api, requests } = fakeApi({
      ls: {
        kind: 'ls',
        path: '/',
        long: false,
        entries: [{ name: 'docs', type: 'dir', size: 0, mtime: '2026-01-01T00:00:00Z' }],
      },
      cat: { kind: 'cat', path: '/a', text: 'hallo\nwelt\n' },
      pwd: { kind: 'pwd', cwd: '/' },
    });
    const sh = new Shell(out, api);
    await sh.execute('ls -l');
    expect(requests.at(-1)).toEqual({ cwd: '/', name: 'ls', args: ['-l'] });
    await sh.execute('ls');
    expect(lines).toContain('docs');
    await sh.execute('cat a');
    expect(lines).toEqual(expect.arrayContaining(['hallo', 'welt']));
    await sh.execute('pwd');
    expect(lines.at(-1)).toBe('/');
  });

  it('checks flags locally before asking the server', async () => {
    const { out, lines } = fakeOutput();
    const { api, requests } = fakeApi();
    await new Shell(out, api).execute('ls -R');
    expect(lines).toContain('ls: unbekannte Option: -R');
    expect(requests).toEqual([]);
  });

  it('tracks the directory after cd and resets it when the server rejects it', async () => {
    const { out, lines } = fakeOutput();
    const { api, requests } = fakeApi({
      cd: { kind: 'cd', cwd: '/docs' },
      ls: { kind: 'error', message: 'Aktueller Ordner ungültig', resetCwd: true },
    });
    const sh = new Shell(out, api);
    await sh.execute('cd docs');
    expect(sh.cwd).toBe('/docs');
    expect(lines).toEqual([]);
    await sh.execute('ls');
    expect(requests.at(-1)?.cwd).toBe('/docs');
    expect(sh.cwd).toBe('/');
    expect(lines.join(' ')).toContain('ungültig');
  });

  it('shows server and network errors', async () => {
    const { out, lines } = fakeOutput();
    const api: ServerApi = {
      command: async () => {
        throw new ApiError('Server nicht erreichbar.');
      },
      complete: async () => [],
    };
    await new Shell(out, api).execute('ls');
    expect(lines).toContain('ls: Server nicht erreichbar.');
  });

  it('stays silent when the user aborts a request', async () => {
    const { out, lines } = fakeOutput();
    const controller = new AbortController();
    const api: ServerApi = {
      command: (_req, signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))),
        ),
      complete: async () => [],
    };
    const done = new Shell(out, api).execute('ls', controller.signal);
    controller.abort();
    await done;
    expect(lines).toEqual([]);
  });

  it('completes command names', async () => {
    const { out, lines } = fakeOutput();
    const sh = new Shell(out);
    expect(await sh.complete('he')).toBe('help ');
    expect(await sh.complete('xyz')).toBe('xyz');
    expect(lines).toEqual([]);
  });

  it('lists candidates when completion is ambiguous', async () => {
    const { out, lines } = fakeOutput();
    const sh = new Shell(out);
    // c -> cat, cd, clear, cls: gemeinsamer Präfix bleibt "c", Kandidaten werden gelistet
    expect(await sh.complete('c')).toBe('c');
    expect(lines.join(' ')).toMatch(/cat +cd +clear +cls/);
    expect(await sh.complete('cl')).toBe('cl');
  });

  it('completes paths through the server', async () => {
    const { out } = fakeOutput();
    const { api, completions } = fakeApi({}, ['docs/']);
    const sh = new Shell(out, api);
    expect(await sh.complete('cd do')).toBe('cd docs/');
    expect(completions.at(-1)).toEqual({ cwd: '/', partial: 'do' });
    expect(await sh.complete('ls -la do')).toBe('ls -la docs/');
  });

  it('adds a space after a completed file and lists several candidates', async () => {
    const { out, lines } = fakeOutput();
    const one = new Shell(out, fakeApi({}, ['docs/a.txt']).api);
    expect(await one.complete('cat docs/a')).toBe('cat docs/a.txt ');
    const many = new Shell(out, fakeApi({}, ['docs/alpha.txt', 'docs/alps/']).api);
    expect(await many.complete('cat docs/a')).toBe('cat docs/alp');
    expect(lines.at(-1)).toMatch(/alpha\.txt +alps\//);
  });

  it('does not complete paths for commands without path arguments', async () => {
    const { out } = fakeOutput();
    const { api, completions } = fakeApi({}, ['x']);
    expect(await new Shell(out, api).complete('pwd x')).toBe('pwd x');
    expect(completions).toEqual([]);
  });
});
