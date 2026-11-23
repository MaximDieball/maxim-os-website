import { describe, expect, it } from 'vitest';
import { despeckle, RAMP, toAscii, toGray } from './portrait.ts';

/** RGBA-Bild mit einer Funktion (x, y) -> [r, g, b, a]. */
function image(w: number, h: number, px: (x: number, y: number) => number[]) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4);
  }
  return toGray(data, w, h);
}

describe('toGray', () => {
  it('computes luminance and composites transparency on black', () => {
    const g = image(2, 1, (x) => (x === 0 ? [255, 255, 255, 255] : [255, 255, 255, 0]));
    expect(g.data[0]).toBeCloseTo(1);
    expect(g.data[1]).toBeCloseTo(0);
  });
});

describe('toAscii', () => {
  it('maps dark to space and bright to dense characters', () => {
    const white = toAscii(
      image(40, 40, () => [255, 255, 255, 255]),
      10,
      { contrast: false },
    );
    expect(white.every((l) => l === RAMP.at(-1)!.repeat(10))).toBe(true);
    const black = toAscii(
      image(40, 40, () => [0, 0, 0, 255]),
      10,
      { contrast: false },
    );
    expect(black.every((l) => l === '')).toBe(true);
  });

  it('keeps the requested width and derives the height from the aspect ratio', () => {
    const lines = toAscii(
      image(100, 100, () => [200, 200, 200, 255]),
      20,
      { aspect: 2 },
    );
    expect(lines).toHaveLength(10);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(20);
  });

  it('follows a gradient from left (dark) to right (bright)', () => {
    const lines = toAscii(
      image(100, 20, (x) => [x * 2.55, x * 2.55, x * 2.55, 255]),
      10,
      { aspect: 2, contrast: false },
    );
    const row = lines[0]!.padEnd(10);
    const rank = [...row].map((c) => RAMP.indexOf(c));
    for (let i = 1; i < rank.length; i++) expect(rank[i]!).toBeGreaterThanOrEqual(rank[i - 1]!);
    expect(rank[0]).toBe(0);
    expect(rank.at(-1)).toBeGreaterThanOrEqual(RAMP.length - 2);
  });

  it('stretches contrast so faint images still use the full ramp', () => {
    const faint = image(100, 20, (x) => {
      const v = 100 + x * 0.4;
      return [v, v, v, 255];
    });
    const chars = new Set(toAscii(faint, 20, { aspect: 2 }).join('').replace(/ /g, ''));
    expect(chars.has(RAMP.at(-1)!)).toBe(true);
  });

  it('turns values below the floor into spaces', () => {
    const dim = image(40, 40, () => [20, 20, 20, 255]);
    const bright = image(40, 40, () => [255, 255, 255, 255]);
    expect(toAscii(dim, 10, { contrast: false, floor: 0.15 }).every((l) => l === '')).toBe(true);
    expect(toAscii(bright, 10, { contrast: false, floor: 0.15 })[0]).toBe('@'.repeat(10));
  });

  it('only uses ramp characters and has no trailing spaces', () => {
    const lines = toAscii(
      image(60, 60, (x, y) => [(x * y) % 256, x * 4, y * 4, 255]),
      30,
    );
    for (const l of lines) {
      expect(l).toBe(l.trimEnd());
      for (const c of l) expect(RAMP.includes(c)).toBe(true);
    }
  });
});

describe('despeckle', () => {
  it('removes small islands but keeps larger connected areas', () => {
    expect(despeckle(['@@    .', '@@    .:', '', '   :'])).toEqual(['@@', '@@', '', '']);
  });
});
