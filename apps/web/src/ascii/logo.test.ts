import { describe, expect, it } from 'vitest';
import { logoLines, NARROW_MAX_COLS } from './logo.ts';

const width = (lines: string[]) => Math.max(...lines.map((l) => [...l].length));

describe('MAXIM OS logo', () => {
  it('renders wide on one block line set', () => {
    const lines = logoLines(80);
    expect(lines).toHaveLength(5);
    expect(width(lines)).toBeLessThanOrEqual(80);
  });

  it('renders a narrow variant that fits small phones', () => {
    const lines = logoLines(NARROW_MAX_COLS);
    expect(lines.length).toBeGreaterThan(5);
    expect(width(lines)).toBeLessThanOrEqual(NARROW_MAX_COLS);
  });

  it('picks the narrow variant when the wide one does not fit', () => {
    expect(logoLines(50)).toEqual(logoLines(NARROW_MAX_COLS));
  });

  it('has no trailing whitespace', () => {
    for (const l of [...logoLines(80), ...logoLines(40)]) expect(l).toBe(l.trimEnd());
  });
});
