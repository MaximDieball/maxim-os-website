import { logoLines } from '../ascii/logo.ts';
import { gradient, style, wrap } from '../shell/text.ts';

export const TAGLINE = 'an ai coding project';
export const HINT = "Tippe 'help' für alle Commands oder 'steckbrief', um mich kennenzulernen.";

type Rgb = readonly [number, number, number];
const LOGO_DEFAULT: { from: Rgb; to: Rgb } = { from: [34, 211, 238], to: [192, 132, 252] };

/** Hebt die Command-Namen im Hinweis hervor (nach dem Umbrechen, damit die Breite stimmt). */
const highlight = (line: string): string =>
  line.replace(/'(help|steckbrief)'/g, (_m, name: string) => `'${style.yellow(name)}'`);

/** Zeilen des ersten Screens, passend zur Terminalbreite. */
export function startscreenLines(cols: number, logoColors = LOGO_DEFAULT): string[] {
  const logo = logoLines(cols);
  const logoWidth = Math.max(...logo.map((l) => l.length));
  const pad = ' '.repeat(Math.max(0, Math.floor((logoWidth - TAGLINE.length) / 2)));
  return [
    '',
    ...logo.map((l, i) =>
      style.bold(style.rgb(l, gradient(logoColors.from, logoColors.to, i, logo.length))),
    ),
    '',
    style.dim(pad + TAGLINE),
    '',
    ...wrap(HINT, Math.max(20, cols - 1)).map(highlight),
    '',
  ];
}
