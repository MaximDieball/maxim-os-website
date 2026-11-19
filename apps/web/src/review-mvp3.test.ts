/**
 * Security-Review #66 (MVP 3): Terminal-Injection über Snapshot, eigene Dateien,
 * Fehlermeldungen und manipulierten localStorage. Tests mit `[FINDING-n]` beschreiben
 * das sichere Sollverhalten und waren rot, solange die Lücke bestand (seit den Fixes zu #66 grün)
 * (siehe docs/security-review-mvp3.md).
 */
import { describe, expect, it } from 'vitest';
import type { FsNode, Snapshot } from '@maxim-os/shared';
import { clean } from './shell/format.ts';
import { Shell, type ShellOutput } from './shell/shell.ts';
import { STORAGE_KEY, Workspace, type KeyValueStore } from './vfs/workspace.ts';
import { Vfs } from './vfs/vfs.ts';

const T = '2026-01-01T00:00:00.000Z';

/** Alles, was ein Terminal steuern kann: C0, DEL, C1 sowie Bidi-Overrides/-Isolates/-Marks. */
// eslint-disable-next-line no-control-regex
const DANGER = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;
/** Die eigenen Farb-Sequenzen der Shell (SGR) sind erlaubt. */
// eslint-disable-next-line no-control-regex
const OWN_SGR = /\x1b\[[0-9;]*m/g;

/** Payload mit OSC (Titel), CSI (Bildschirm löschen), C1-CSI/OSC/DCS/ST, Bidi, BS, DEL, CR. */
const EVIL =
  'a\x1b]0;pwned\x07b\x1b[2Jc\x1b[31md\u009b2Je\u009d0;x\u009cf\u0090q\x1b\\g' +
  '‮RTL⁦iso⁩h\bi\x7fj\rk\x00l\x1bPdcs\x1b\\m\u0085n\n';

/** Ausgabe, die alles ungefiltert mitschreibt, was ans Terminal ginge. */
function rawOutput(cols = 100) {
  const lines: string[] = [];
  const out: ShellOutput = {
    print: (l) => lines.push(...l),
    clear: () => {
      lines.length = 0;
    },
    cols: () => cols,
  };
  return { out, lines };
}

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function expectSafe(lines: readonly string[]): void {
  for (const line of lines) {
    const rest = line.replace(OWN_SGR, '');
    expect(rest, JSON.stringify(line)).not.toMatch(DANGER);
  }
}

const file = (name: string, text: string): FsNode => ({
  type: 'file',
  name,
  mtime: T,
  size: text.length,
  text,
});

/** Snapshot, wie ihn ein manipulierter oder fehlerhafter Server liefern könnte. */
const SNAP: Snapshot = {
  version: 'v-review',
  root: {
    type: 'dir',
    name: '',
    mtime: T,
    children: [
      file('evil.txt', EVIL),
      file('pre1.txt', 'x'),
      file('pre2.txt', 'y'),
      file('alm.txt', 'a؜b\n'),
      file('x\x1b[2J.txt', 'x'),
      file('y\u009b31m.txt', 'y'),
      file('z‮txt.exe', 'z'),
      file('w\nnl.txt', 'w'),
      { type: 'file', name: 'bin\x1b]0;x\x07', mtime: T, size: 3, binary: true },
      {
        type: 'dir',
        name: 'docs',
        mtime: T,
        children: [file('a.txt', 'A\n'), file('b\x1b[1A.txt', 'B')],
      },
      { type: 'dir', name: 'dir\x1b]8;;http://x\x07', mtime: T, children: [file('ok', 'ok')] },
    ],
  },
};

async function run(sh: Shell, lines: string[]): Promise<void> {
  for (const line of lines) await sh.execute(line);
}

const READ_COMMANDS = [
  'ls',
  'ls -l',
  'ls -la',
  'ls -a docs',
  'tree',
  'tree -L 5',
  'cat evil.txt',
  'cat docs/a.txt',
  'ls -l evil.txt',
];

describe('review #66: snapshot names and content', () => {
  it('drops snapshot entries with escape, C1, bidi or newline in their names', () => {
    const ws = Workspace.open(SNAP, memoryStore());
    const names = ws.fs.list('/').map((n) => n.name);
    expect(names).toEqual(['alm.txt', 'docs', 'evil.txt', 'pre1.txt', 'pre2.txt']);
    expect(ws.fs.list('/docs').map((n) => n.name)).toEqual(['a.txt']);
  });

  it('never prints escape, OSC, CSI, C1 or bidi characters (wide and narrow)', async () => {
    for (const cols of [100, 40]) {
      const { out, lines } = rawOutput(cols);
      const sh = new Shell(out, Workspace.open(SNAP, memoryStore()));
      await run(sh, READ_COMMANDS);
      expect(lines.join('\n')).toContain('pwned');
      expectSafe(lines);
    }
  });

  it('keeps escape sequences out of files written by redirection', async () => {
    const { out, lines } = rawOutput();
    const ws = Workspace.open(SNAP, memoryStore());
    const sh = new Shell(out, ws);
    await run(sh, ['cat evil.txt > copy.txt', 'ls -l > list.txt', 'tree >> list.txt']);
    for (const path of ['/copy.txt', '/list.txt']) {
      expect(ws.fs.readText(path).replace(/\n/g, ''), path).not.toMatch(DANGER);
    }
    await run(sh, ['cat copy.txt list.txt']);
    expectSafe(lines);
  });

  it('[FINDING-2] removes the bidi control U+061C (Arabic letter mark) from output', async () => {
    const { out, lines } = rawOutput();
    const sh = new Shell(out, Workspace.open(SNAP, memoryStore()));
    await sh.execute('cat alm.txt');
    expect(lines.join('')).not.toContain('؜');
  });
});

describe('review #66: names and content created by the user', () => {
  it('never creates names with control or bidi characters', async () => {
    const { out, lines } = rawOutput();
    const ws = Workspace.open(SNAP, memoryStore());
    const sh = new Shell(out, ws);
    await run(sh, [
      'mkdir "d\x1b[31mir"',
      'touch "‮exe.txt"',
      "touch 'c1\u009b2J'",
      'echo "\x1b]0;pwned\x07" > "o\x1b[2Jut.txt"',
      'echo "x\u0085y⁦z" >> out2.txt',
      'mkdir -p "p\x1b/q\u009b"',
      'cp evil.txt "e\x1bvil2.txt"',
      'mv pre1.txt "pr‮e1.txt"',
    ]);
    const walk = (path: string): string[] =>
      ws.fs
        .list(path)
        .flatMap((n) => [n.name, ...(n.type === 'dir' ? walk(ws.fs.resolve(path, n.name)) : [])]);
    for (const name of walk('/')) expect(name, JSON.stringify(name)).not.toMatch(DANGER);
    await run(sh, ['ls -la', 'tree', 'cat out2.txt', 'pwd']);
    expectSafe(lines);
  });

  it('rejects such names when resolving paths in the VFS', () => {
    const fs = Vfs.fromSnapshot(SNAP.root);
    for (const bad of ['a\x1bb', 'a\u009bb', 'a‮b', 'a⁦b', 'a\nb', 'a\\b']) {
      expect(() => fs.resolve('/', bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe('review #66: input echoed in error messages', () => {
  it('never echoes control or escape characters from the input', async () => {
    const { out, lines } = rawOutput();
    const sh = new Shell(out, Workspace.open(SNAP, memoryStore()));
    await run(sh, [
      'nosuch\x1b[2J',
      '\u009b2Jcmd',
      'ls --x\x1b]0;t\x07',
      'ls -\u009b',
      'cd "\x1b]0;x\x07"',
      'cat "‮missing"',
      'cat nope\x1b[1A',
      'tree -L 9\x1b[2J',
      'tree -L "1‮"',
      'rm "a⁦b"',
      '"unclosed\x1b',
      'ls > "\x1b[2J"',
      'cat evil.txt > docs',
      `ls ${'\x1b'.repeat(300)}`,
    ]);
    expect(lines.length).toBeGreaterThan(5);
    expectSafe(lines);
  });

  it('filters messages handed to error() and fsError() directly (defense in depth)', () => {
    const { out, lines } = rawOutput();
    const sh = new Shell(out);
    sh.error('a\x1b]0;x\x07b\u009b2Jc‮d');
    sh.fsError('cat', '\x1b[2J⁦', new Error('\x1b[2J'));
    expectSafe(lines);
  });

  it('prints clean tab-completion candidates', async () => {
    const { out, lines } = rawOutput();
    const sh = new Shell(out, Workspace.open(SNAP, memoryStore()));
    expect(await sh.complete('cat pre')).toBe('cat pre');
    expect(lines.join(' ')).toContain('pre1.txt');
    expectSafe(lines);
  });

  it('clean() removes everything that could steer the terminal (prompt uses it too)', () => {
    expect(clean(EVIL.replace(/\n/g, ''))).not.toMatch(DANGER);
  });
});

describe('review #66: manipulated localStorage', () => {
  const stored = (root: unknown): KeyValueStore => {
    const store = memoryStore();
    store.setItem(STORAGE_KEY, JSON.stringify({ base: SNAP.version, root }));
    return store;
  };

  it('drops bad names and filters content and metadata from the stored copy', async () => {
    const store = stored({
      type: 'dir',
      name: '\x1b[2J',
      mtime: '\x1b]0;x\x07',
      children: [
        { type: 'file', name: 'n\x1b[31m', mtime: T, size: 1, text: 'x' },
        { type: 'file', name: 'evil.txt', mtime: '\x1b[2J', size: 1, text: EVIL },
        { type: 'dir', name: 'd‮', mtime: T, children: [] },
        { type: 'dir', name: 'ok', mtime: 'nope', children: [file('in\u009b', 'x')] },
      ],
    });
    const { out, lines } = rawOutput();
    const ws = Workspace.open(SNAP, store);
    expect(ws.fs.list('/').map((n) => n.name)).toEqual(['evil.txt', 'ok']);
    const sh = new Shell(out, ws);
    await run(sh, ['ls -la', 'ls -l ok', 'tree', 'cat evil.txt']);
    expectSafe(lines);
  });

  it('[FINDING-3] does not print control characters from a stored binary file size', async () => {
    const store = stored({
      type: 'dir',
      name: '',
      mtime: T,
      children: [{ type: 'file', name: 'x.bin', mtime: T, size: '\r\n\u000b\f5', binary: true }],
    });
    const { out, lines } = rawOutput();
    const sh = new Shell(out, Workspace.open(SNAP, store));
    await sh.execute('ls -l');
    expect(lines.join('\n')).toContain('x.bin');
    expectSafe(lines);
  });
});

describe('review #66: robustness of the local copy (info)', () => {
  it('[FINDING-4] keeps the 1024-character path limit when moving or copying folders', () => {
    const fs = Vfs.fromSnapshot(SNAP.root);
    const seg = (c: string) => c.repeat(200);
    const deep = `/${[seg('a'), seg('b'), seg('c'), seg('d'), seg('e')].join('/')}`;
    fs.mkdir(deep, { parents: true });
    expect(deep.length).toBeLessThanOrEqual(1024);
    fs.mkdir(`/${seg('z')}`);
    const moveOrCopy = () => {
      try {
        fs.copy(`/${seg('a')}`, `/${seg('z')}`, { recursive: true });
      } catch {
        // abgelehnt: gut
      }
      try {
        fs.move(`/${seg('a')}`, `/${seg('z')}`);
      } catch {
        // abgelehnt: gut
      }
    };
    moveOrCopy();
    const longest = (path: string): number =>
      Math.max(
        path.length,
        ...fs
          .list(path)
          .filter((n) => n.type === 'dir')
          .map((n) => longest(path === '/' ? `/${n.name}` : `${path}/${n.name}`)),
      );
    expect(longest('/')).toBeLessThanOrEqual(1024);
  });
});

describe('review #66: no HTML injection', () => {
  it('never assigns HTML strings to the DOM in the web sources', () => {
    const sources = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(10);
    for (const [path, text] of files) {
      expect(String(text), path).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser|srcdoc/,
      );
    }
  });
});
