import { stripAnsi } from '../shell/text.ts';

/** Zustand der Eingabezeile, gespiegelt aus dem nativen <input>. */
export interface PromptState {
  value: string;
  /** Caret-Position in UTF-16-Einheiten (wie selectionStart). */
  caret: number;
  focused: boolean;
}

export interface RenderedPrompt {
  /** Escape-Sequenz, die die Zeile an Ort und Stelle neu zeichnet. */
  seq: string;
  /** Zeile (relativ zum Prompt-Anfang), in der xterm.js danach den Cursor hat. */
  rows: number;
}

// Breite Zeichen (CJK, Fullwidth, Emoji) belegen zwei Terminalzellen.
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;

export function cellWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += WIDE.test(ch) ? 2 : 1;
  return width;
}

const inverse = (s: string): string => `\x1b[7m${s}\x1b[27m`;

/**
 * Zeichnet Prompt + Eingabe mit Block-Cursor neu. `prevRows` ist `rows` des
 * vorherigen Aufrufs: so weit geht es zuerst nach oben, dann wird bis zum
 * Bildschirmende gelöscht. Die Zeile ist immer die letzte im Terminal.
 */
export function renderPromptLine(
  prompt: string,
  state: PromptState,
  cols: number,
  prevRows: number,
): RenderedPrompt {
  const { value, focused } = state;
  const caret = Math.max(0, Math.min(state.caret, value.length));
  const before = value.slice(0, caret);
  const atCaret = String.fromCodePoint(value.codePointAt(caret) ?? 0x20);
  const after = value.slice(caret + (caret < value.length ? atCaret.length : 0));
  const cursor = focused ? inverse(atCaret) : atCaret;

  const cells = cellWidth(stripAnsi(prompt)) + cellWidth(value) + (caret >= value.length ? 1 : 0);
  const rows = Math.floor((cells - 1) / Math.max(1, cols));
  const up = prevRows > 0 ? `\x1b[${prevRows}A` : '';
  return { seq: `${up}\r\x1b[J${prompt}${before}${cursor}${after}`, rows };
}
