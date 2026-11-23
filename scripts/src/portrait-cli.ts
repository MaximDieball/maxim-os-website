/**
 * Erzeugt das ASCII-Porträt für den Steckbrief (#27) im Container:
 *   make portrait
 * Liest assets/headshot/image.png und schreibt content/about/portrait.txt (breit)
 * und content/about/portrait-narrow.txt (schmal, für Handys).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { crop, despeckle, toAscii, toGray } from './portrait.ts';

const root = join(import.meta.dirname, '..', '..');
const input = join(root, 'assets', 'headshot', 'image.png');
const outDir = join(root, 'content', 'about');

/**
 * Ausgangsbreiten in Spalten. Nach dem Zuschneiden auf Kopf und Schultern bleibt etwa
 * die Hälfte: breit ca. 40 Spalten (neben dem Text auf dem Desktop), schmal ca. 20 (Handy).
 */
const VARIANTS = [
  { file: 'portrait.txt', cols: 56 },
  { file: 'portrait-narrow.txt', cols: 44 },
] as const;

const png = PNG.sync.read(readFileSync(input));
const gray = toGray(png.data, png.width, png.height);
mkdirSync(outDir, { recursive: true });
for (const { file, cols } of VARIANTS) {
  const lines = crop(despeckle(toAscii(gray, cols, { aspect: 2.1, floor: 0.12 }), 6));
  const target = join(outDir, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${lines.join('\n')}\n`);
  console.log(`${file}: ${Math.max(...lines.map((l) => l.length))} × ${lines.length}`);
}
