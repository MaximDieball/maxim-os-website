import { describe, expect, it } from 'vitest';
import { urlAt } from './links.ts';

describe('urlAt', () => {
  const line = '  https://github.com/MaximDieball/ChessBot  (Python)';

  it('finds the http(s) link under the column', () => {
    expect(urlAt(line, 2)).toBe('https://github.com/MaximDieball/ChessBot');
    expect(urlAt(line, 20)).toBe('https://github.com/MaximDieball/ChessBot');
    expect(urlAt(line, 41)).toBe('https://github.com/MaximDieball/ChessBot');
  });

  it('returns undefined next to the link', () => {
    expect(urlAt(line, 0)).toBeUndefined();
    expect(urlAt(line, 43)).toBeUndefined();
    expect(urlAt('kein Link hier', 3)).toBeUndefined();
  });

  it('ignores other schemes and strips trailing punctuation', () => {
    expect(urlAt('javascript:alert(1)', 3)).toBeUndefined();
    expect(urlAt('siehe https://maximdieball.de/.', 10)).toBe('https://maximdieball.de/');
    expect(urlAt('(https://maximdieball.de)', 5)).toBe('https://maximdieball.de');
  });

  it('handles several links on one line', () => {
    const two = 'a https://a.example b https://b.example';
    expect(urlAt(two, 4)).toBe('https://a.example');
    expect(urlAt(two, 25)).toBe('https://b.example');
  });
});
