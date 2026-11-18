import { describe, expect, it } from 'vitest';
import { LineAccumulator, momentumStep } from './touch-scroll.ts';

describe('LineAccumulator', () => {
  it('turns finger movement into whole lines (finger down = scroll up)', () => {
    const acc = new LineAccumulator(20);
    expect(acc.feed(45)).toBe(-2); // 5 px Rest
    expect(acc.feed(-100)).toBe(4); // 5 - 100 = -95 px
    expect(acc.feed(-15)).toBe(1); // -15 - 15 = -30 px
  });

  it('keeps the remainder between moves', () => {
    const acc = new LineAccumulator(20);
    expect(acc.feed(15)).toBe(0);
    expect(acc.feed(10)).toBe(-1); // 25 px = 1 Zeile, 5 px Rest
    expect(acc.feed(15)).toBe(-1);
  });

  it('resets the remainder', () => {
    const acc = new LineAccumulator(20);
    acc.feed(15);
    acc.reset();
    expect(acc.feed(10)).toBe(0);
  });

  it('ignores a cell height of zero', () => {
    expect(new LineAccumulator(0).feed(100)).toBe(0);
  });
});

describe('momentumStep', () => {
  it('decays velocity over time', () => {
    const v = momentumStep(1, 16);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
    expect(momentumStep(-1, 16)).toBeGreaterThan(-1);
  });

  it('stops below a minimum speed', () => {
    expect(momentumStep(0.01, 16)).toBe(0);
  });
});
