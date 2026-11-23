/**
 * ASCII-Bild-Generator (#27): rechnet ein Foto in Zeichen um. Für dunklen
 * Hintergrund: helle Stellen werden zu dichten Zeichen, dunkle zu Leerzeichen.
 */

/** Zeichen von dunkel (Leerzeichen) nach hell (dicht). */
export const RAMP = ' .:-=+*#%@';

export interface Gray {
  width: number;
  height: number;
  /** Helligkeit 0..1 pro Pixel, Transparenz auf Schwarz gerechnet. */
  data: Float32Array;
}

/** RGBA-Daten in Helligkeit umrechnen (Rec. 709). */
export function toGray(rgba: Uint8Array, width: number, height: number): Gray {
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4]! / 255;
    const g = rgba[i * 4 + 1]! / 255;
    const b = rgba[i * 4 + 2]! / 255;
    const a = rgba[i * 4 + 3]! / 255;
    data[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) * a;
  }
  return { width, height, data };
}

export interface AsciiOptions {
  /** Verhältnis Zellenhöhe zu Zellenbreite (Terminal ca. 2). */
  aspect?: number;
  /** Kontrast auf das 2.–98. Perzentil strecken. */
  contrast?: boolean;
  /** Werte darunter (nach Kontrast) werden zu Leerzeichen, gegen Rauschen in dunklen Flächen. */
  floor?: number;
}

/** Rechnet ein Bild in `cols` Spalten um. Zeilen ohne Leerzeichen am Ende. */
export function toAscii(img: Gray, cols: number, options: AsciiOptions = {}): string[] {
  const aspect = options.aspect ?? 2;
  const floor = options.floor ?? 0;
  const rows = Math.max(1, Math.round((cols * img.height) / img.width / aspect));
  const cellW = img.width / cols;
  const cellH = img.height / rows;

  // Mittelwert pro Zelle
  const cells = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * cellW);
      const x1 = Math.max(x0 + 1, Math.floor((c + 1) * cellW));
      const y0 = Math.floor(r * cellH);
      const y1 = Math.max(y0 + 1, Math.floor((r + 1) * cellH));
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) sum += img.data[y * img.width + x]!;
      }
      cells[r * cols + c] = sum / ((x1 - x0) * (y1 - y0));
    }
  }

  let lo = 0;
  let hi = 1;
  if (options.contrast !== false) {
    const sorted = [...cells].sort((a, b) => a - b);
    lo = sorted[Math.floor(sorted.length * 0.02)] ?? 0;
    hi = sorted[Math.floor(sorted.length * 0.98)] ?? 1;
    if (hi - lo < 1e-3) {
      lo = 0;
      hi = 1;
    }
  }

  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const v = Math.min(1, Math.max(0, (cells[r * cols + c]! - lo) / (hi - lo)));
      line += v < floor ? ' ' : RAMP[Math.round(v * (RAMP.length - 1))];
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Entfernt kleine Inseln (weniger als `min` verbundene Zeichen), z. B. Rauschen an Schnittkanten. */
export function despeckle(lines: string[], min = 4): string[] {
  const grid = lines.map((l) => [...l]);
  const seen = grid.map((row) => row.map(() => false));
  const filled = (r: number, c: number) => (grid[r]?.[c] ?? ' ') !== ' ';
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r]!.length; c++) {
      if (!filled(r, c) || seen[r]![c]) continue;
      // Zusammenhängende Fläche (8er-Nachbarschaft) einsammeln
      const island: [number, number][] = [];
      const stack: [number, number][] = [[r, c]];
      seen[r]![c] = true;
      while (stack.length) {
        const [y, x] = stack.pop()!;
        island.push([y, x]);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (filled(ny, nx) && !seen[ny]![nx]) {
              seen[ny]![nx] = true;
              stack.push([ny, nx]);
            }
          }
        }
      }
      if (island.length < min) for (const [y, x] of island) grid[y]![x] = ' ';
    }
  }
  return grid.map((row) => row.join('').trimEnd());
}

/** Leere Zeilen oben und unten entfernen und den gemeinsamen linken Rand kürzen. */
export function crop(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start++;
  while (end > start && lines[end - 1]!.trim() === '') end--;
  const body = lines.slice(start, end);
  const indent = Math.min(
    ...body.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length),
  );
  return body.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
}
