import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../shell/text.ts';
import { HINT, startscreenLines, TAGLINE } from './startscreen.ts';

describe('startscreen', () => {
  it('shows tagline and hint', () => {
    const text = startscreenLines(100).map(stripAnsi).join('\n');
    expect(text).toContain(TAGLINE);
    expect(text.replace(/\u00a0/g, ' ')).toContain("'help --short'");
    expect(text).toContain("'steckbrief'");
  });

  it.each([40, 44, 80, 140])('fits into %i columns without wrapping', (cols) => {
    for (const l of startscreenLines(cols)) expect(stripAnsi(l).length).toBeLessThanOrEqual(cols);
  });

  it('centers MAXIM and OS on narrow screens', () => {
    const lines = startscreenLines(40).map(stripAnsi);
    const logo = lines.slice(1, lines.indexOf('', 1));
    expect(logo.length).toBeGreaterThan(0);
    for (const l of logo.filter((x) => x.trim())) {
      const left = l.length - l.trimStart().length;
      expect(left, l).toBeGreaterThan(0);
    }
  });

  it('keeps the logo left-aligned on wide screens', () => {
    const lines = startscreenLines(140).map(stripAnsi);
    expect(lines[1]!.length - lines[1]!.trimStart().length).toBeLessThanOrEqual(2);
  });

  it('keeps the hint text intact when wrapped', () => {
    const text = startscreenLines(40).map(stripAnsi).join(' ').replace(/\s+/g, ' ');
    expect(text).toContain(HINT.replace(/\u00a0/g, ' '));
  });
});
