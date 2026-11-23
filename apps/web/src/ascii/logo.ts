/**
 * ASCII-Logo "MAXIM OS" (#48): auf dem Desktop "Pixel" aus einer eigenen
 * 5×7-Bitmap-Schrift, auf dem Handy "Minimal" (gesperrte Buchstaben zwischen Linien).
 *
 * Rückgabe sind Blöcke (z. B. [MAXIM] und [OS] auf dem Handy), damit der
 * Startscreen jeden Block für sich zentrieren kann (#49).
 */

/** Breite, ab der die schmale Variante verwendet wird (ca. 360 px Displaybreite). */
export const NARROW_MAX_COLS = 40;

// 5×7-Bitmaps: '#' = Pixel gesetzt.
const BITMAP: Record<string, string[]> = {
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
};
const ROWS = 7;

/** Pixelraster eines Wortes: Buchstaben mit 1 Pixel Abstand. */
function raster(word: string): boolean[][] {
  const rows: boolean[][] = Array.from({ length: ROWS }, () => []);
  [...word].forEach((ch, i) => {
    const glyph = BITMAP[ch];
    if (!glyph) return;
    for (let r = 0; r < ROWS; r++) {
      if (i > 0) rows[r]!.push(false);
      for (const p of glyph[r]!) rows[r]!.push(p === '#');
    }
  });
  return rows;
}

/** Raster aus mehreren Wörtern mit größerem Wortabstand. */
function rasterWords(words: string[], gap: number): boolean[][] {
  const parts = words.map(raster);
  return Array.from({ length: ROWS }, (_, r) =>
    parts.flatMap((p, i) => (i > 0 ? [...Array<boolean>(gap).fill(false), ...p[r]!] : p[r]!)),
  );
}

const trim = (lines: string[]): string[] => lines.map((l) => l.trimEnd());

/** Groß: jedes Pixel als "██" (ungefähr quadratisch). */
function big(grid: boolean[][]): string[] {
  return trim(grid.map((row) => row.map((p) => (p ? '██' : '  ')).join('')));
}

/** Mittel: ein Zeichen pro Pixel (Blöcke wirken wie eine LED-Matrix). */
function solid(grid: boolean[][]): string[] {
  return trim(grid.map((row) => row.map((p) => (p ? '█' : ' ')).join('')));
}

/**
 * Gesperrte Buchstaben zwischen zwei feinen Linien. (Senkrechte Rahmenlinien
 * zeichnet der DOM-Renderer von xterm.js mit Lücken, waagerechte laufen durch.)
 */
function ruled(text: string, gap = 1): string[] {
  const spaced = [...text].map((c) => (c === ' ' ? ' '.repeat(gap + 1) : c)).join(' '.repeat(gap));
  const bar = '─'.repeat(spaced.length + 4);
  return [bar, `  ${spaced}`, bar];
}

const widthOf = (lines: string[]) => Math.max(...lines.map((l) => [...l].length));

/**
 * Stufen von groß nach klein; die erste, die passt, wird genommen (Auswahl in #48):
 * Desktop "Pixel" (groß, dann ein Zeichen pro Pixel), Handy "Minimal".
 */
function tiers(): string[][][] {
  const words = rasterWords(['MAXIM', 'OS'], 3);
  return [[big(words)], [solid(words)], [ruled('MAXIM OS', 1)], [ruled('MAXIM'), ruled('OS')]];
}

/** Logo-Blöcke, die in `cols` Spalten passen. */
export function logoBlocks(cols: number): string[][] {
  const options = tiers();
  for (const blocks of options) {
    if (widthOf(blocks.flat()) <= cols) return blocks;
  }
  return options.at(-1)!;
}
