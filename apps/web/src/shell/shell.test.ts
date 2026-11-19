import { describe, expect, it } from 'vitest';
import { COMMANDS, type Snapshot } from '@maxim-os/shared';
import { Workspace, type KeyValueStore } from '../vfs/workspace.ts';
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

const T = '2026-01-01T00:00:00.000Z';
const SNAP: Snapshot = {
  version: 'v1',
  root: {
    type: 'dir',
    name: '',
    mtime: T,
    children: [
      { type: 'file', name: 'README.txt', mtime: T, size: 6, text: 'hallo\n' },
      { type: 'file', name: '.geheim', mtime: T, size: 1, text: 'x' },
      { type: 'file', name: 'evil.txt', mtime: T, size: 9, text: 'a\u001b]0;pwned\u0007b\n' },
      { type: 'file', name: 'bild.png', mtime: T, size: 3, binary: true },
      {
        type: 'dir',
        name: 'projects',
        mtime: T,
        children: [{ type: 'file', name: 'maxim-os.txt', mtime: T, size: 3, text: 'MO\n' }],
      },
    ],
  },
};

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function setup(cols = 100) {
  const { out, lines, clears } = fakeOutput(cols);
  const ws = Workspace.open(SNAP, memoryStore());
  const sh = new Shell(out, ws);
  return { sh, ws, out, lines, clears };
}

describe('Shell basics', () => {
  it('prints help with all registry commands', async () => {
    const { sh, lines } = setup();
    await sh.execute('help');
    for (const name of ['clear', 'ls [-l] [-a]', 'mkdir', 'rm', 'mv', 'cp', 'echo', 'reset']) {
      expect(lines.join('\n')).toContain(name);
    }
  });

  it('clears via clear and alias', async () => {
    const { sh, clears } = setup();
    await sh.execute('clear');
    await sh.execute('cls');
    expect(clears()).toBe(2);
  });

  it('reports unknown commands without echoing escape sequences', async () => {
    const { sh, lines } = setup();
    await sh.execute('rm-rf');
    expect(lines).toContain("command not found: rm-rf. Tippe 'help'.");
    await sh.execute('\x1b]0;pwned\x07evil');
    expect(lines.join('')).not.toContain('\x1b');
    await sh.execute('a'.repeat(200));
    expect(lines.at(-1)!.length).toBeLessThan(80);
  });

  it('rejects unknown flags and wrong argument counts', async () => {
    const { sh, lines } = setup();
    await sh.execute('clear --force');
    expect(lines).toContain('clear: unbekannte Option: --force');
    await sh.execute('ls -R');
    expect(lines).toContain('ls: unbekannte Option: -R');
    await sh.execute('mv a');
    expect(lines).toContain('mv: Quelle und Ziel fehlt');
  });

  it('reports unmatched quotes and ignores empty input', async () => {
    const { sh, lines } = setup();
    await sh.execute('cat "open');
    expect(lines.join(' ')).toContain('Anführungszeichen');
    const before = lines.length;
    await sh.execute('   ');
    expect(lines.length).toBe(before);
  });

  it('does not treat prototype keys as commands', async () => {
    const { sh, lines } = setup();
    await sh.execute('constructor');
    expect(lines).toContain("command not found: constructor. Tippe 'help'.");
  });

  it('says when the file system is not available', async () => {
    const { out, lines } = fakeOutput();
    const sh = new Shell(out, Promise.resolve(undefined));
    await sh.execute('ls');
    expect(lines.join(' ')).toContain('Dateisystem nicht verfügbar');
    await sh.execute('help');
    expect(lines.join(' ')).toContain('Verfügbare Commands');
  });
});

describe('reading commands', () => {
  it('ls lists entries, -a shows hidden ones', async () => {
    const { sh, lines } = setup();
    await sh.execute('ls');
    expect(lines.join(' ')).toMatch(/README\.txt.*projects/);
    expect(lines.join(' ')).not.toContain('.geheim');
    await sh.execute('ls -a');
    expect(lines.join(' ')).toContain('.geheim');
    await sh.execute('ls -l projects');
    expect(lines.at(-1)).toMatch(/-r?w?-?r--r-- +3 .* maxim-os\.txt$|maxim-os\.txt$/);
  });

  it('cd and pwd track the directory, refuse files and missing paths', async () => {
    const { sh, lines } = setup();
    await sh.execute('cd projects');
    expect(sh.cwd).toBe('/projects');
    await sh.execute('pwd');
    expect(lines.at(-1)).toBe('/projects');
    await sh.execute('cd ../README.txt');
    expect(lines.at(-1)).toBe('cd: ../README.txt: Kein Ordner');
    await sh.execute('cd /nope');
    expect(lines.at(-1)).toBe('cd: /nope: Datei oder Ordner nicht gefunden');
    await sh.execute('cd ../../..');
    expect(sh.cwd).toBe('/');
  });

  it('cat prints text, strips control characters and refuses binaries', async () => {
    const { sh, lines } = setup();
    await sh.execute('cat README.txt');
    expect(lines.at(-1)).toBe('hallo');
    await sh.execute('cat evil.txt');
    expect(lines.join('')).not.toContain('\x1b');
    expect(lines.join('')).not.toContain('\x07');
    await sh.execute('cat bild.png');
    expect(lines.at(-1)).toBe('cat: bild.png: Binärdatei, kann nicht angezeigt werden');
  });

  it('tree draws the structure', async () => {
    const { sh, lines } = setup();
    await sh.execute('tree');
    expect(lines.join('\n')).toContain('└── maxim-os.txt');
    expect(lines.join('\n')).toMatch(/1 Ordner, 4 Dateien/);
  });
});

describe('writing commands', () => {
  it('mkdir, touch, echo with redirection and cat work together', async () => {
    const { sh, lines, ws } = setup();
    await sh.execute('mkdir -p notizen/2026');
    await sh.execute('touch notizen/leer.txt');
    await sh.execute('echo hallo welt > notizen/2026/gruss.txt');
    await sh.execute('echo zweite zeile >> notizen/2026/gruss.txt');
    await sh.execute('cat notizen/2026/gruss.txt');
    expect(lines.slice(-2)).toEqual(['hallo welt', 'zweite zeile']);
    expect(ws.fs.readText('/notizen/leer.txt')).toBe('');
  });

  it('redirects command output without colors', async () => {
    const { sh, ws } = setup();
    await sh.execute('ls > liste.txt');
    expect(ws.fs.readText('/liste.txt')).toContain('README.txt');
    expect(ws.fs.readText('/liste.txt')).not.toContain('\x1b');
    await sh.execute('pwd >> liste.txt');
    expect(ws.fs.readText('/liste.txt').trimEnd().split('\n').at(-1)).toBe('/');
  });

  it('refuses redirection for commands without text output', async () => {
    const { sh, lines } = setup();
    await sh.execute('cd projects > x.txt');
    expect(lines.at(-1)).toBe('cd: Ausgabe kann nicht umgeleitet werden');
  });

  it('rm, rmdir, mv and cp behave like a shell', async () => {
    const { sh, lines, ws } = setup();
    await sh.execute('rm projects');
    expect(lines.at(-1)).toBe('rm: projects: Ist ein Ordner (rm -r verwenden)');
    await sh.execute('cp -r projects backup');
    await sh.execute('mv README.txt backup/');
    expect(ws.fs.get('/backup/README.txt')?.type).toBe('file');
    await sh.execute('rm -r projects');
    expect(ws.fs.get('/projects')).toBeUndefined();
    await sh.execute('rm nope.txt');
    expect(lines.at(-1)).toBe('rm: nope.txt: Datei oder Ordner nicht gefunden');
    const before = lines.length;
    await sh.execute('rm -f nope.txt');
    expect(lines.length).toBe(before);
    await sh.execute('mkdir leer');
    await sh.execute('rmdir leer backup');
    expect(ws.fs.get('/leer')).toBeUndefined();
    expect(lines.at(-1)).toBe('rmdir: backup: Ordner ist nicht leer');
  });

  it('moves the shell to / when the current directory disappears', async () => {
    const { sh } = setup();
    await sh.execute('cd projects');
    await sh.execute('rm -r /projects');
    expect(sh.cwd).toBe('/');
  });

  it('saves after writing commands', async () => {
    const store = memoryStore();
    const { out } = fakeOutput();
    const sh = new Shell(out, Workspace.open(SNAP, store));
    await sh.execute('echo persistent > p.txt');
    expect(Workspace.open(SNAP, store).fs.readText('/p.txt')).toBe('persistent\n');
  });

  it('echo prints its arguments, including dashes', async () => {
    const { sh, lines } = setup();
    await sh.execute('echo -n "a  b" c');
    expect(lines.at(-1)).toBe('-n a  b c');
  });
});

/** Wartet, bis die Shell eine Frage stellt (execute ist asynchron). */
async function question(sh: Shell): Promise<string> {
  for (let i = 0; i < 50 && !sh.inputPrompt; i++) await new Promise((r) => setTimeout(r, 0));
  return sh.inputPrompt ?? '';
}

describe('reset', () => {
  it('asks before resetting and only resets on y', async () => {
    const { sh, ws } = setup();
    await sh.execute('rm README.txt');
    const no = sh.execute('reset');
    expect(await question(sh)).toContain('(y/N)');
    expect(sh.answer('n')).toBe(true);
    await no;
    expect(ws.fs.get('/README.txt')).toBeUndefined();
    const yes = sh.execute('reset');
    await question(sh);
    expect(sh.answer('y')).toBe(true);
    await yes;
    expect(ws.fs.readText('/README.txt')).toBe('hallo\n');
    expect(sh.inputPrompt).toBeUndefined();
  });

  it('cancels the question on abort', async () => {
    const { sh, ws } = setup();
    await sh.execute('rm README.txt');
    const controller = new AbortController();
    const pending = sh.execute('reset', controller.signal);
    await question(sh);
    controller.abort();
    await pending;
    expect(sh.inputPrompt).toBeUndefined();
    expect(ws.fs.get('/README.txt')).toBeUndefined();
    expect(sh.answer('y')).toBe(false);
  });
});

describe('completion', () => {
  it('completes command names', async () => {
    const { sh, lines } = setup();
    expect(await sh.complete('he')).toBe('help ');
    expect(await sh.complete('xyz')).toBe('xyz');
    const before = lines.length;
    expect(await sh.complete('c')).toBe('c');
    expect(lines.length).toBe(before + 1);
    expect(lines.at(-1)).toMatch(/cat +cd +clear +cls +cp/);
  });

  it('completes paths locally, directories with a slash, files with a space', async () => {
    const { sh, lines } = setup();
    expect(await sh.complete('cd pro')).toBe('cd projects/');
    expect(await sh.complete('cat projects/m')).toBe('cat projects/maxim-os.txt ');
    expect(await sh.complete('ls -la pro')).toBe('ls -la projects/');
    expect(await sh.complete('cat .g')).toBe('cat .geheim ');
    expect(await sh.complete('cat ')).toBe('cat ');
    expect(lines.at(-1)).toMatch(/README\.txt +bild\.png +evil\.txt +projects\//);
  });

  it('does not complete paths for commands without path arguments', async () => {
    const { sh } = setup();
    expect(await sh.complete('pwd pro')).toBe('pwd pro');
  });
});
