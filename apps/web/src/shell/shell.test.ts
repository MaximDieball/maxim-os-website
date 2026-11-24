import { describe, expect, it } from 'vitest';
import { COMMANDS, findCommand, type Snapshot } from '@maxim-os/shared';
import type { GithubData } from '../profile/github.ts';
import { Workspace, type KeyValueStore } from '../vfs/workspace.ts';
import { formatCommandHelp, formatHelp, formatHelpShort } from './help.ts';
import { suggestionsIn } from './suggest.ts';
import type { GameScreen } from '../games/run-snake.ts';
import { gameKeyFor } from '../terminal/game-screen.ts';
import { History } from './history.ts';
import { sanitizeInput, stripAnsi } from './text.ts';
import { Shell, type LineAction, type ShellOutput } from './shell.ts';

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
  it('shows the groups in order of importance with steckbrief first', () => {
    const lines = formatHelp(COMMANDS, 120).lines.map(stripAnsi);
    const titles = ['Über mich', 'Projekte und Links', 'Dateien', 'System'];
    const at = titles.map((t) => lines.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Tabelle oder gestapelt: steckbrief kommt vor projects, ls und help
    const first = (name: string) => lines.findIndex((l) => l.trimStart().startsWith(name));
    expect(first('steckbrief')).toBeGreaterThan(-1);
    expect(first('steckbrief')).toBeLessThan(first('projects'));
    expect(first('projects')).toBeLessThan(first('ls'));
    expect(first('ls')).toBeLessThan(first('help'));
    // Spiele nach den Links, vor den Dateien
    expect(lines.indexOf('Im Terminal ausprobieren')).toBeGreaterThan(
      lines.indexOf('Projekte und Links'),
    );
    expect(lines.indexOf('Im Terminal ausprobieren')).toBeLessThan(lines.indexOf('Dateien'));
  });

  it('lists every registry command with description, usage and example', () => {
    // Sehr breit, damit keine Beschreibung in der Tabelle umbricht.
    const text = formatHelp(COMMANDS, 220).lines.map(stripAnsi).join('\n');
    for (const c of COMMANDS) {
      expect(text).toContain(c.name);
      expect(text).toContain(c.description);
      expect(text).toContain(c.usage);
    }
    expect(text).toContain('cls');
  });
  it('uses a stacked layout that fits narrow screens', () => {
    const lines = formatHelp(COMMANDS, 40).lines;
    for (const l of lines) expect(stripAnsi(l).length).toBeLessThanOrEqual(40);
    expect(lines.join('\n')).toMatch(/Beispiel: +help --short/);
  });
  it('uses a table on desktop widths and wraps long descriptions inside it', () => {
    const lines = formatHelp(COMMANDS, 120).lines.map(stripAnsi);
    expect(lines.some((l) => /COMMAND +BESCHREIBUNG +USAGE +BEISPIEL/.test(l))).toBe(true);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(120);
    // kompakt: deutlich kürzer als die gestapelte Variante
    expect(lines.length).toBeLessThan(formatHelp(COMMANDS, 40).lines.length / 2);
  });

  it('makes every command clickable to open its details', () => {
    const out = formatHelp(COMMANDS, 120);
    const commands = out.actions
      .flat()
      .filter(Boolean)
      .map((a) => a!.command);
    for (const c of COMMANDS) expect(commands).toContain(`help ${c.name}`);
    expect(commands).toContain('help --short');
  });

  it('fits the wide layout into the given width', () => {
    for (const l of formatHelp(COMMANDS, 120).lines)
      expect(stripAnsi(l).length).toBeLessThanOrEqual(120);
  });
});

describe('help --short and help <command> (#93)', () => {
  it('explains help and fits on a desktop screen', () => {
    for (const cols of [120, 40]) {
      const out = formatHelpShort(COMMANDS, cols);
      const lines = out.lines.map(stripAnsi);
      expect(lines.length).toBeLessThanOrEqual(26);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(cols);
      const text = lines.join(' ').replace(/\u00a0/g, ' ');
      expect(text).toContain('help <command>');
      expect(text).toContain("'help'");
      // steckbrief steht vor ls und help, alle Commands sind klickbar
      expect(text.indexOf('steckbrief')).toBeLessThan(text.indexOf(' ls '));
      const commands = out.actions
        .flat()
        .filter(Boolean)
        .map((a) => a!.command);
      for (const c of COMMANDS) expect(commands).toContain(`help ${c.name}`);
      expect(commands).toContain('help');
    }
  });

  it('places the click ranges exactly on the names in compact rows', () => {
    const out = formatHelpShort(COMMANDS, 120);
    const i = out.lines.findIndex((l) => /\bmkdir\b/.test(stripAnsi(l)));
    const plainLine = stripAnsi(out.lines[i]!);
    for (const a of out.actions[i] as LineAction[]) {
      expect(plainLine.slice(a.from, a.to)).toBe(a.command.replace('help ', ''));
    }
  });

  it('shows details of one command', () => {
    const out = formatCommandHelp(findCommand('ls')!, 80);
    const text = out.lines.map(stripAnsi).join('\n');
    for (const s of ['Usage', 'ls [-l] [-a]', 'Beispiel', '-l  ausführliche Liste', 'Dateien']) {
      expect(text).toContain(s);
    }
    const commands = out.actions
      .flat()
      .filter(Boolean)
      .map((a) => a!.command);
    expect(commands).toContain(findCommand('ls')!.example);
    expect(commands).toContain('help --short');
    // Beispiele, die etwas verändern, sind nicht klickbar
    const rm = formatCommandHelp(findCommand('rm')!, 80).actions.flat().filter(Boolean);
    expect(rm.map((a) => a!.command)).not.toContain(findCommand('rm')!.example);
  });

  it('help <command>, help -s, aliases and unknown names in the shell', async () => {
    const { sh, lines } = setup();
    await sh.execute('help --short');
    expect(lines.join('\n')).toContain('Kurzfassung');
    await sh.execute('help cls');
    expect(lines.join('\n')).toMatch(/^clear$/m);
    await sh.execute('help nope');
    expect(lines.join('\n')).toContain('help: nope: Unbekannter Command.');
    expect(await sh.complete('help ste')).toBe('help steckbrief ');
  });
});

describe('clickable suggestions (#93)', () => {
  it('finds quoted commands with their columns', () => {
    const line = "Tippe 'help\u00a0--short' oder 'steckbrief'. 'project <name>' 'foo'";
    expect(suggestionsIn(`\x1b[2m${line}\x1b[22m`)).toEqual([
      { command: 'help --short', from: 6, to: 20 },
      { command: 'steckbrief', from: 26, to: 38 },
    ]);
  });

  it('only the own hint of command not found is clickable', async () => {
    const printed: unknown[] = [];
    const { out } = fakeOutput(120);
    out.print = (_l, a) => void printed.push(a);
    const sh = new Shell(out, Workspace.open(SNAP, memoryStore()));
    await sh.execute('"\'reset\'"');
    const actions = (printed.at(-1) as LineAction[][])[0]!;
    expect(actions.map((a) => a.command)).toEqual(['help --short']);
  });
});

describe('watchthis (#34)', () => {
  function watch() {
    const opened: string[] = [];
    const { out, lines } = fakeOutput(60);
    let replaced = 0;
    out.replaceLast = (l) => {
      replaced++;
      lines[lines.length - 1] = stripAnsi(l);
    };
    const sh = new Shell(out, undefined, {
      delay: async () => {},
      openUrl: (u) => void opened.push(u),
    });
    return { sh, lines, opened, replaced: () => replaced };
  }

  it('shows a progress bar, then opens the page and offers a link', async () => {
    const { sh, lines, opened, replaced } = watch();
    await sh.execute('watchthis');
    expect(replaced()).toBe(10);
    expect(lines.join('\n')).toMatch(/\[█+\] 100%/);
    expect(opened).toEqual(['https://movies.maxim-dieball.de']);
    expect(lines.at(-1)).toBe('https://movies.maxim-dieball.de');
  });

  it('works with the aliases wt and WatchThis', async () => {
    const { sh, opened } = watch();
    await sh.execute('wt');
    await sh.execute('WatchThis');
    expect(opened).toHaveLength(2);
  });

  it('opens nothing when cancelled with Ctrl+C', async () => {
    const { sh, opened } = watch();
    const controller = new AbortController();
    controller.abort();
    await sh.execute('watchthis', controller.signal);
    expect(opened).toEqual([]);
  });
});

describe('minecraft (#36)', () => {
  function mc(result: unknown) {
    const { out, lines } = fakeOutput(80);
    out.replaceLast = (l) => {
      lines[lines.length - 1] = stripAnsi(l);
    };
    const sh = new Shell(out, undefined, {
      minecraft: async () => result as never,
    });
    return { sh, lines };
  }

  it('shows the status and replaces the waiting line', async () => {
    const { sh, lines } = mc({
      online: true,
      address: 'minecraft.maxim-dieball.de',
      players: { online: 1, max: 10, names: ['Steve'] },
      latencyMs: 30,
    });
    await sh.execute('mc');
    expect(lines.join('\n')).not.toContain('Frage den Minecraft-Server');
    expect(lines[0]).toContain('● online');
    expect(lines.join('\n')).toContain('Steve');
  });

  it('is friendly when offline or unreachable', async () => {
    const off = mc({ online: false, address: 'x' });
    await off.sh.execute('minecraft');
    expect(off.lines.join('\n')).toContain('gerade offline');
    const gone = mc(undefined);
    await gone.sh.execute('minecraft');
    expect(gone.lines.at(-1)).toContain('Status gerade nicht abrufbar');
  });
});

describe('snake (#32, #33)', () => {
  function game(mobile: boolean) {
    const { out, lines } = fakeOutput(80);
    let entered = 0;
    const screen: GameScreen = {
      enter: () => (entered++, { cols: 80, rows: 24 }),
      draw: () => {},
      onKey: (h) => (h('quit'), () => {}),
      leave: () => {},
    };
    const sh = new Shell(out, undefined, {
      gameScreen: () => screen,
      isMobile: () => mobile,
      delay: async () => {},
    });
    return { sh, lines, entered: () => entered };
  }

  it('starts the game on desktop and reports the score afterwards', async () => {
    const { sh, lines, entered } = game(false);
    await sh.execute('snake');
    expect(entered()).toBe(1);
    expect(lines.join('\n')).toContain('Snake beendet. Score 0');
  });

  it('warns on phones and cancels by default', async () => {
    const { sh, lines, entered } = game(true);
    const run = sh.execute('snake');
    expect(await question(sh)).toContain('Snake wird auf Handys nicht unterstützt');
    sh.answer('');
    await run;
    expect(entered()).toBe(0);
    expect(lines.at(-1)).toBe('Abgebrochen.');
  });

  it('starts anyway on phones after y', async () => {
    const { sh, entered } = game(true);
    const run = sh.execute('snake');
    await question(sh);
    sh.answer('y');
    await run;
    expect(entered()).toBe(1);
  });
});

describe('gameKeyFor', () => {
  it('maps arrows, layout-independent WASD, Esc and Ctrl+C', () => {
    const k = (key: string, code = '', ctrlKey = false) => gameKeyFor({ key, code, ctrlKey });
    expect(k('ArrowUp')).toBe('up');
    expect(k('z', 'KeyW')).toBe('up'); // AZERTY: physische W-Taste
    expect(k('a', 'KeyA')).toBe('left');
    expect(k('Escape')).toBe('quit');
    expect(k('c', 'KeyC', true)).toBe('quit');
    expect(k('Enter')).toBe('confirm');
    expect(k('x', 'KeyX')).toBeUndefined();
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
    expect(lines).toContain("command not found: rm-rf. Tippe 'help\u00a0--short'.");
    await sh.execute('\x1b]0;pwned\x07evil');
    expect(lines.join('')).not.toContain('\x1b');
    await sh.execute('a'.repeat(200));
    expect(lines.at(-1)!.length).toBeLessThan(90);
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
    expect(lines).toContain("command not found: constructor. Tippe 'help\u00a0--short'.");
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

describe('profile commands', () => {
  const GH: GithubData = {
    source: 'github',
    profile: { login: 'MaximDieball', name: 'Maxim', htmlUrl: 'https://github.com/MaximDieball' },
    repos: [{ name: 'maxim-os-website', url: 'https://github.com/MaximDieball/maxim-os-website' }],
  };
  const FALLBACK_SNAP: Snapshot = {
    version: 'v2',
    root: {
      ...SNAP.root,
      children: [
        ...SNAP.root.children,
        {
          type: 'dir',
          name: 'about',
          mtime: T,
          children: [
            {
              type: 'file',
              name: 'steckbrief.json',
              mtime: T,
              size: 0,
              text: JSON.stringify({
                profile: { login: 'Offline', htmlUrl: 'https://github.com/Offline' },
                repos: [],
              }),
            },
            {
              type: 'file',
              name: 'portrait-narrow.txt',
              mtime: T,
              size: 0,
              text: '#####\n#####\n',
            },
            { type: 'file', name: 'about.txt', mtime: T, size: 0, text: 'Über MAXIM OS\n' },
          ],
        },
      ],
    },
  };

  it('steckbrief uses GitHub data', async () => {
    const { out, lines } = fakeOutput(40);
    const sh = new Shell(out, Workspace.open(FALLBACK_SNAP, memoryStore()), {
      github: async () => GH,
    });
    await sh.execute('steckbrief');
    expect(lines.join('\n')).toContain('Maxim');
    expect(lines.join('\n')).toContain('#####');
  });

  it('steckbrief falls back to content/about/steckbrief.json', async () => {
    const { out, lines } = fakeOutput(40);
    const sh = new Shell(out, Workspace.open(FALLBACK_SNAP, memoryStore()), {
      github: async () => undefined,
    });
    await sh.execute('steckbrief');
    expect(lines.join('\n')).toContain('Offline');
    expect(lines.join('\n')).toContain('gespeicherte Daten');
  });

  it('steckbrief reports missing data', async () => {
    const { sh, lines } = setup();
    await sh.execute('steckbrief');
    expect(lines.at(-1)).toContain('steckbrief: Daten nicht verfügbar');
  });

  it('projects lists repos as clickable lines', async () => {
    const actions: string[] = [];
    const { out, lines } = fakeOutput(80);
    out.print = (l, a) => {
      lines.push(...l.map(stripAnsi));
      a?.flat().forEach((x) => x && actions.push(x.command));
    };
    const sh = new Shell(out, Workspace.open(SNAP, memoryStore()), { github: async () => GH });
    await sh.execute('projects');
    expect(lines.join('\n')).toContain('maxim-os-website');
    expect(actions).toContain('project maxim-os-website');
  });

  it('project shows info and README of a repo, case-insensitive', async () => {
    const asked: string[] = [];
    const { out, lines } = fakeOutput(80);
    const sh = new Shell(out, Workspace.open(SNAP, memoryStore()), {
      github: async () => GH,
      readme: async (r) => (asked.push(r), '# Mein Projekt\n\nText'),
    });
    await sh.execute('project MAXIM-os-website');
    expect(asked).toEqual(['maxim-os-website']);
    const text = lines.join('\n');
    expect(text).toContain('https://github.com/MaximDieball/maxim-os-website');
    expect(text).toContain('Mein Projekt');
  });

  it('project lists the projects for unknown names', async () => {
    const { out, lines } = fakeOutput(80);
    const sh = new Shell(out, Workspace.open(SNAP, memoryStore()), { github: async () => GH });
    await sh.execute('project nope');
    expect(lines.join('\n')).toContain('project: nope: Projekt nicht gefunden');
    expect(lines.join('\n')).toContain('maxim-os-website');
    await sh.execute('project');
    expect(lines.at(-1)).toMatch(/project/);
  });

  it('completes project names', async () => {
    const { out } = fakeOutput(80);
    const sh = new Shell(out, Workspace.open(SNAP, memoryStore()), { github: async () => GH });
    expect(await sh.complete('project max')).toBe('project maxim-os-website ');
  });

  it('project pages show download links from the content folder, also with live data', async () => {
    const snap = structuredClone(FALLBACK_SNAP);
    const about = snap.root.children.find((c) => c.name === 'about') as {
      children: { name: string; text?: string }[];
    };
    about.children[0]!.text = JSON.stringify({
      profile: { login: 'Offline', htmlUrl: 'https://github.com/Offline' },
      projectLinks: {
        'MAXIM-OS-WEBSITE': [{ kind: 'product', label: 'Live', url: 'https://maxim-dieball.de' }],
      },
    });
    const { out, lines } = fakeOutput(80);
    const sh = new Shell(out, Workspace.open(snap, memoryStore()), { github: async () => GH });
    await sh.execute('project maxim-os-website');
    expect(lines.join('\n')).toMatch(/Produkt +Live/);
    expect(lines.join('\n')).toContain('https://maxim-dieball.de/');
  });

  it('steckbrief always shows the facts from the content folder', async () => {
    const snap = structuredClone(FALLBACK_SNAP);
    const about = snap.root.children.find((c) => c.name === 'about') as {
      children: { name: string; text?: string }[];
    };
    about.children[0]!.text = JSON.stringify({
      profile: { login: 'Offline', htmlUrl: 'https://github.com/Offline' },
      facts: [{ label: 'Studium', value: 'Nordakademie' }],
    });
    const { out, lines } = fakeOutput(40);
    const sh = new Shell(out, Workspace.open(snap, memoryStore()), { github: async () => GH });
    await sh.execute('steckbrief');
    expect(lines.join('\n')).toContain('Maxim');
    expect(lines.join('\n')).toContain('Nordakademie');
  });

  it('about prints about.txt, whoami says guest, history numbers the input', async () => {
    const { out, lines } = fakeOutput(80);
    const sh = new Shell(out, Workspace.open(FALLBACK_SNAP, memoryStore()));
    await sh.execute('about');
    expect(lines).toContain('Über MAXIM OS');
    await sh.execute('whoami');
    expect(lines).toContain('guest');
    await sh.execute('history');
    expect(lines.slice(-3)).toEqual(['   1  about', '   2  whoami', '   3  history']);
  });
});
