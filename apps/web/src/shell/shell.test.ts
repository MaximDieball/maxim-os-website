import { describe, expect, it } from 'vitest';
import { COMMANDS } from '@maxim-os/shared';
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

describe('Shell', () => {
  it('prints help', () => {
    const { out, lines } = fakeOutput();
    new Shell(out).execute('help');
    expect(lines.join('\n')).toContain('clear');
  });

  it('clears via clear and alias', () => {
    const { out, clears } = fakeOutput();
    const sh = new Shell(out);
    sh.execute('clear');
    sh.execute('cls');
    expect(clears()).toBe(2);
  });

  it('reports unknown commands', () => {
    const { out, lines } = fakeOutput();
    new Shell(out).execute('rm -rf /');
    expect(lines).toContain("command not found: rm. Tippe 'help'.");
  });

  it('does not echo escape sequences of unknown commands', () => {
    const { out, lines } = fakeOutput();
    new Shell(out).execute('\x1b]0;pwned\x07evil');
    expect(lines.join('')).not.toContain('\x1b');
  });

  it('truncates very long unknown command names', () => {
    const { out, lines } = fakeOutput();
    new Shell(out).execute('a'.repeat(200));
    expect(lines[0]!.length).toBeLessThan(80);
  });

  it('rejects unexpected parameters (allowlist)', () => {
    const { out, lines } = fakeOutput();
    new Shell(out).execute('clear --force');
    expect(lines).toContain('clear: unerwarteter Parameter: --force');
  });

  it('ignores empty input and records history', () => {
    const { out, lines } = fakeOutput();
    const sh = new Shell(out);
    sh.execute('   ');
    expect(lines).toEqual([]);
    sh.execute('help');
    expect(sh.history.entries()).toEqual(['help']);
  });

  it('does not treat prototype keys as commands', () => {
    const { out, lines } = fakeOutput();
    new Shell(out).execute('constructor');
    expect(lines).toContain("command not found: constructor. Tippe 'help'.");
  });

  it('completes command names', () => {
    const { out, lines } = fakeOutput();
    const sh = new Shell(out);
    expect(sh.complete('he')).toBe('help ');
    expect(sh.complete('xyz')).toBe('xyz');
    expect(lines).toEqual([]);
  });

  it('lists candidates when completion is ambiguous', () => {
    const { out, lines } = fakeOutput();
    const sh = new Shell(out);
    // c -> cat, cd, clear, cls: gemeinsamer Präfix bleibt "c", Kandidaten werden gelistet
    expect(sh.complete('c')).toBe('c');
    expect(lines.join(' ')).toMatch(/cat +cd +clear +cls/);
    expect(sh.complete('cl')).toBe('cl');
  });
});
