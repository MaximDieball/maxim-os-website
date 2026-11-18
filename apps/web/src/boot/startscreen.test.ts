import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../shell/text.ts';
import { HINT, startscreenLines, TAGLINE } from './startscreen.ts';

describe('startscreen', () => {
  it('shows tagline and hint', () => {
    const text = startscreenLines(100).map(stripAnsi).join('\n');
    expect(text).toContain(TAGLINE);
    expect(text).toContain("'help'");
    expect(text).toContain("'steckbrief'");
  });

  it.each([40, 44, 80, 140])('fits into %i columns without wrapping', (cols) => {
    for (const l of startscreenLines(cols)) expect(stripAnsi(l).length).toBeLessThanOrEqual(cols);
  });

  it('keeps the hint text intact when wrapped', () => {
    const text = startscreenLines(40).map(stripAnsi).join(' ').replace(/\s+/g, ' ');
    expect(text).toContain(HINT);
  });
});
