import { describe, expect, it } from 'vitest';
import { findCommand } from './commands.ts';
import { LIMITS, parseArgs, tokenize } from './parse.ts';

const spec = (name: string) => {
  const s = findCommand(name);
  if (!s) throw new Error(name);
  return s;
};

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('  ls   -l  docs ')).toEqual({ ok: true, tokens: ['ls', '-l', 'docs'] });
  });

  it('keeps quoted parts together', () => {
    expect(tokenize(`cat "my notes.txt" 'a b'`)).toEqual({
      ok: true,
      tokens: ['cat', 'my notes.txt', 'a b'],
    });
    expect(tokenize(`cat x"y z"`)).toEqual({ ok: true, tokens: ['cat', 'xy z'] });
  });

  it('keeps empty quoted tokens', () => {
    expect(tokenize(`cat ""`)).toEqual({ ok: true, tokens: ['cat', ''] });
  });

  it('rejects unmatched quotes', () => {
    expect(tokenize(`cat "open`).ok).toBe(false);
  });

  it('rejects too long lines and too many tokens', () => {
    expect(tokenize('a'.repeat(LIMITS.line + 1)).ok).toBe(false);
    expect(
      tokenize(
        Array(LIMITS.tokens + 1)
          .fill('x')
          .join(' '),
      ).ok,
    ).toBe(false);
  });

  it('rejects control characters', () => {
    expect(tokenize('cat a\u0000b').ok).toBe(false);
    expect(tokenize('cat a\u001b[31m').ok).toBe(false);
  });

  it('returns no tokens for blank input', () => {
    expect(tokenize('   ')).toEqual({ ok: true, tokens: [] });
  });
});

describe('tokenize: redirection', () => {
  it('recognizes > and >> with or without spaces', () => {
    expect(tokenize('echo hallo > a.txt')).toEqual({
      ok: true,
      tokens: ['echo', 'hallo'],
      redirect: { append: false, target: 'a.txt' },
    });
    expect(tokenize('echo hallo>>a.txt')).toEqual({
      ok: true,
      tokens: ['echo', 'hallo'],
      redirect: { append: true, target: 'a.txt' },
    });
    expect(tokenize('ls -l >"mein ordner.txt"')).toMatchObject({
      tokens: ['ls', '-l'],
      redirect: { append: false, target: 'mein ordner.txt' },
    });
  });

  it('keeps arguments after the target like a shell', () => {
    expect(tokenize('echo a > f.txt b')).toMatchObject({
      tokens: ['echo', 'a', 'b'],
      redirect: { target: 'f.txt' },
    });
  });

  it('treats quoted > as text', () => {
    expect(tokenize(`echo "a > b" '>>'`)).toEqual({ ok: true, tokens: ['echo', 'a > b', '>>'] });
  });

  it('rejects missing targets, double redirects and >>>', () => {
    for (const line of ['echo a >', 'echo a > ', 'echo a > b > c', 'echo a >>> b', 'echo > >> b']) {
      expect(tokenize(line).ok, line).toBe(false);
    }
  });
});

describe('parseArgs', () => {
  it('accepts allowed short flags, also combined', () => {
    expect(parseArgs(spec('ls'), ['-l'])).toEqual({ ok: true, flags: { l: true }, operands: [] });
    expect(parseArgs(spec('ls'), ['-la', 'docs'])).toEqual({
      ok: true,
      flags: { l: true, a: true },
      operands: ['docs'],
    });
    expect(parseArgs(spec('ls'), ['-a', '-l'])).toMatchObject({ flags: { l: true, a: true } });
  });

  it('rejects unknown flags with a clear message', () => {
    const r = parseArgs(spec('ls'), ['-R']);
    expect(r).toEqual({ ok: false, error: 'ls: unbekannte Option: -R' });
    expect(parseArgs(spec('ls'), ['-lR']).ok).toBe(false);
    expect(parseArgs(spec('ls'), ['--all'])).toEqual({
      ok: false,
      error: 'ls: unbekannte Option: --all',
    });
    expect(parseArgs(spec('cat'), ['-n', 'x']).ok).toBe(false);
  });

  it('accepts registered long options as their short flag (#93)', () => {
    expect(parseArgs(spec('help'), ['--short'])).toEqual({
      ok: true,
      flags: { s: true },
      operands: [],
    });
    expect(parseArgs(spec('help'), ['-s'])).toMatchObject({ ok: true, flags: { s: true } });
    expect(parseArgs(spec('help'), ['ls'])).toMatchObject({ ok: true, operands: ['ls'] });
    expect(parseArgs(spec('help'), ['--shorter']).ok).toBe(false);
  });

  it('treats everything after -- as operands', () => {
    expect(parseArgs(spec('cat'), ['--', '-weird.txt'])).toEqual({
      ok: true,
      flags: {},
      operands: ['-weird.txt'],
    });
  });

  it('parses integer option values within range', () => {
    expect(parseArgs(spec('tree'), ['-L', '2'])).toEqual({
      ok: true,
      flags: { L: 2 },
      operands: [],
    });
    expect(parseArgs(spec('tree'), ['-L3', 'docs'])).toEqual({
      ok: true,
      flags: { L: 3 },
      operands: ['docs'],
    });
    expect(parseArgs(spec('tree'), ['-L']).ok).toBe(false);
    expect(parseArgs(spec('tree'), ['-L', 'x']).ok).toBe(false);
    expect(parseArgs(spec('tree'), ['-L', '99']).ok).toBe(false);
    expect(parseArgs(spec('tree'), ['-L', '1e3']).ok).toBe(false);
  });

  it('enforces operand counts', () => {
    expect(parseArgs(spec('pwd'), ['x'])).toEqual({
      ok: false,
      error: 'pwd: zu viele Argumente',
    });
    expect(parseArgs(spec('cat'), [])).toEqual({ ok: false, error: 'cat: Datei fehlt' });
    expect(parseArgs(spec('cd'), ['a', 'b']).ok).toBe(false);
  });

  it('rejects a lone dash', () => {
    expect(parseArgs(spec('cat'), ['-']).ok).toBe(false);
  });

  it('passes raw arguments through for echo', () => {
    expect(parseArgs(spec('echo'), ['-n', '--x', 'hallo'])).toMatchObject({
      ok: true,
      operands: ['-n', '--x', 'hallo'],
    });
  });

  it('cannot be tricked by prototype keys', () => {
    expect(parseArgs(spec('ls'), ['-_']).ok).toBe(false);
    const r = parseArgs(spec('ls'), ['-l']);
    expect(r.ok && Object.getPrototypeOf(r.flags)).toBe(null);
  });
});
