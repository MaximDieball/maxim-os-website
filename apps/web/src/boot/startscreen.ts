import { logoBlocks } from '../ascii/logo.ts';
import { gradient, style, wrap } from '../shell/text.ts';

export const TAGLINE = 'an ai coding project';
export const HINT = "Tippe 'help' für alle Commands oder 'steckbrief', um mich kennenzulernen.";

type Rgb = readonly [number, number, number];
const LOGO_DEFAULT: { from: Rgb; to: Rgb } = { from: [34, 211, 238], to: [192, 132, 252] };

/** Hebt die Command-Namen im Hinweis hervor (nach dem Umbrechen, damit die Breite stimmt). */
const highlight = (line: string): string =>
  line.replace(/'(help|steckbrief)'/g, (_m, name: string) => `'${style.yellow(name)}'`);

/** Bis zu dieser Breite (Spalten) werden Logo und Tagline zentriert (#49). */
export const CENTER_MAX_COLS = 60;

const widthOf = (lines: string[]): number => Math.max(0, ...lines.map((l) => [...l].length));
const padTo = (width: number, cols: number): string =>
  ' '.repeat(Math.max(0, Math.floor((cols - width) / 2)));

/** Zeilen des ersten Screens, passend zur Terminalbreite. */
export function startscreenLines(cols: number, logoColors = LOGO_DEFAULT): string[] {
  const blocks = logoBlocks(cols);
  const center = cols <= CENTER_MAX_COLS;
  const logoWidth = widthOf(blocks.flat());
  // Jeder Block (z. B. MAXIM und OS) wird für sich zentriert; breit bleibt das Logo links.
  const placed = blocks.flatMap((block) => {
    const pad = center ? padTo(widthOf(block), cols) : '';
    return block.map((l) => pad + l);
  });
  const total = placed.length;
  const tagPad = center ? padTo(TAGLINE.length, cols) : padTo(TAGLINE.length, logoWidth);
  return [
    '',
    ...placed.map((l, i) =>
      style.bold(style.rgb(l, gradient(logoColors.from, logoColors.to, i, total))),
    ),
    '',
    style.dim(tagPad + TAGLINE),
    '',
    ...wrap(HINT, Math.max(20, cols - 1)).map(highlight),
    '',
  ];
}
