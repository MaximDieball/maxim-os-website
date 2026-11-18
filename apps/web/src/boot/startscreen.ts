import { logoLines } from '../ascii/logo.ts';
import { style, wrap } from '../shell/text.ts';

export const TAGLINE = 'an ai coding project';
export const HINT = "Tippe 'help' für alle Commands oder 'steckbrief', um mich kennenzulernen.";

/** Zeilen des ersten Screens, passend zur Terminalbreite. */
export function startscreenLines(cols: number): string[] {
  const logo = logoLines(cols);
  const logoWidth = Math.max(...logo.map((l) => l.length));
  const pad = ' '.repeat(Math.max(0, Math.floor((logoWidth - TAGLINE.length) / 2)));
  return [
    '',
    ...logo.map((l) => style.green(l)),
    '',
    style.dim(pad + TAGLINE),
    '',
    ...wrap(HINT, Math.max(20, cols - 1)),
    '',
  ];
}
