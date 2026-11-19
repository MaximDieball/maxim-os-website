export const MAX_INPUT_LENGTH = 256;

// C0/C1-Steuerzeichen, DEL und bidi-Overrides: dürfen nie ins Terminal gelangen.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c‎‏‪-‮⁦-⁩]/g;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** Entfernt Steuerzeichen aus Benutzereingaben und begrenzt die Länge. */
export function sanitizeInput(input: string): string {
  return input.replace(CONTROL, '').slice(0, MAX_INPUT_LENGTH);
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** Kürzt Text für Fehlermeldungen. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Bricht Text wortweise auf `width` Zeichen um. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
    while (line.length > width) {
      out.push(line.slice(0, width));
      line = line.slice(width);
    }
  }
  if (line) out.push(line);
  return out;
}

export const style = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
  red: (s: string) => `\x1b[31m${s}\x1b[39m`,
  green: (s: string) => `\x1b[32m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[39m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[39m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[39m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[39m`,
  /** Truecolor, z. B. für Farbverläufe. */
  rgb: (s: string, [r, g, b]: readonly [number, number, number]) =>
    `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`,
};

type Rgb = readonly [number, number, number];

/** Linearer Farbverlauf: Farbe für Schritt `i` von `n`. */
export function gradient(from: Rgb, to: Rgb, i: number, n: number): Rgb {
  const t = n <= 1 ? 0 : i / (n - 1);
  return [0, 1, 2].map((k) => Math.round(from[k]! + (to[k]! - from[k]!) * t)) as unknown as Rgb;
}
