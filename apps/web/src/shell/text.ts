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

// Breite Zeichen (CJK, Fullwidth, Emoji) belegen zwei Terminalzellen.
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;

/** Breite in Terminalzellen (breite Zeichen zählen doppelt). */
export function cellWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += WIDE.test(ch) ? 2 : 1;
  return width;
}

/** Teilt ein Wort, das breiter ist als `width`, nach Zellen (nie mitten in einem Zeichen). */
function splitCells(word: string, width: number): string[] {
  const parts: string[] = [];
  let part = '';
  for (const ch of word) {
    if (part && cellWidth(part + ch) > width) {
      parts.push(part);
      part = '';
    }
    part += ch;
  }
  if (part) parts.push(part);
  return parts;
}

/**
 * Bricht Text wortweise auf `width` Terminalzellen um. Breite Zeichen zählen doppelt
 * (#76, L3), damit z. B. chinesische Antworten nicht über den Rand laufen.
 */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  // Geschützte Leerzeichen (\u00a0) trennen nicht, z. B. in 'help\u00a0--short'.
  for (const word of text.split(/[ \t\n\r\f\v]+/).filter(Boolean)) {
    if (!line) line = word;
    else if (cellWidth(line) + 1 + cellWidth(word) <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
    if (cellWidth(line) > width) {
      const parts = splitCells(line, width);
      out.push(...parts.slice(0, -1));
      line = parts.at(-1) ?? '';
    }
  }
  if (line) out.push(line);
  return out;
}

export const style = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
  underline: (s: string) => `\x1b[4m${s}\x1b[24m`,
  /** Klickbarer Command (#93): gelb und unterstrichen, hebt sich auch aus gedimmtem Text ab. */
  command: (s: string, dimAfter = false) =>
    `\x1b[22;4;33m${s}\x1b[24;39m${dimAfter ? '\x1b[2m' : ''}`,
  /** Klickbarer Link: blau und unterstrichen. */
  link: (s: string) => `\x1b[4;34m${s}\x1b[24;39m`,
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
