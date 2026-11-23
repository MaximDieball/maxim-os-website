import { describe, expect, it } from 'vitest';
import { logoBlocks, NARROW_MAX_COLS } from './logo.ts';

const width = (lines: string[]) => Math.max(...lines.map((l) => [...l].length));
const all = (blocks: string[][]) => blocks.flat();

describe('MAXIM OS logo', () => {
  it.each([30, 40, 44, 60, 80, 100, 140])('fits into %i columns', (cols) => {
    expect(width(all(logoBlocks(cols)))).toBeLessThanOrEqual(cols);
  });

  it('uses the big pixel logo on desktop', () => {
    const lines = all(logoBlocks(140));
    expect(lines).toHaveLength(7);
    expect(lines.join('')).toContain('██');
  });

  it('uses one character per pixel on medium widths', () => {
    const lines = all(logoBlocks(60));
    expect(lines).toHaveLength(7);
    // halb so breit wie die große Variante (ein statt zwei Zeichen pro Pixel)
    expect(width(lines) * 2).toBeLessThanOrEqual(width(all(logoBlocks(140))) + 1);
  });

  it('uses the minimal logo on phones', () => {
    const lines = all(logoBlocks(NARROW_MAX_COLS));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('M A X I M');
    expect(lines[0]).toMatch(/^─+$/);
  });

  it('splits MAXIM and OS on very small widths', () => {
    expect(logoBlocks(18)).toHaveLength(2);
  });

  it('has no trailing whitespace', () => {
    for (const cols of [40, 60, 140]) {
      for (const l of all(logoBlocks(cols))) expect(l).toBe(l.trimEnd());
    }
  });
});
