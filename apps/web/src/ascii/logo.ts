/** ASCII-Schriftzug "MAXIM OS" (Figlet-Standard-Stil), breit und schmal. */

const GLYPHS: Record<string, string[]> = {
  M: [' __  __ ', '|  \\/  |', '| |\\/| |', '| |  | |', '|_|  |_|'],
  A: ['    _    ', '   / \\   ', '  / _ \\  ', ' / ___ \\ ', '/_/   \\_\\'],
  X: ['__  __', '\\ \\/ /', ' \\  / ', ' /  \\ ', '/_/\\_\\'],
  I: [' ___ ', '|_ _|', ' | | ', ' | | ', '|___|'],
  O: ['  ___  ', ' / _ \\ ', '| | | |', '| |_| |', ' \\___/ '],
  S: [' ____  ', '/ ___| ', '\\___ \\ ', ' ___) |', '|____/ '],
  ' ': ['  ', '  ', '  ', '  ', '  '],
};

/** Breite, ab der die schmale Variante verwendet wird (ca. 360 px Displaybreite). */
export const NARROW_MAX_COLS = 40;

function render(word: string): string[] {
  const rows = ['', '', '', '', ''];
  for (const ch of word) {
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    glyph.forEach((part, i) => (rows[i] += part));
  }
  return rows.map((r) => r.trimEnd());
}

const WIDE = render('MAXIM OS');
const NARROW = [...render('MAXIM'), ...render('OS')];

const widthOf = (lines: string[]) => Math.max(...lines.map((l) => l.length));

/** Liefert die Logo-Zeilen, die in `cols` Spalten passen. */
export function logoLines(cols: number): string[] {
  return widthOf(WIDE) <= cols ? WIDE : NARROW;
}
