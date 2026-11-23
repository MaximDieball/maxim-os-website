import type { Terminal } from '@xterm/xterm';

/**
 * Klickbare Links in der Terminal-Ausgabe (#31). Eigene Umsetzung statt des
 * xterm-Link-Addons: Dessen Erkennung geht durch unser Fokus-Handling verloren und
 * funktioniert auf Touch-Geräten schlecht. Beim Klick bzw. Tippen wird die Zelle
 * unter dem Zeiger bestimmt, die logische Zeile gelesen (auch umgebrochen) und ein
 * http(s)-Link an dieser Stelle in einem neuen Tab geöffnet.
 */

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING = /[.,;:!?)\]]+$/;

/** Link (http/https) an Spalte `col` einer Zeile, sonst undefined. */
export function urlAt(line: string, col: number): string | undefined {
  for (const match of line.matchAll(URL_RE)) {
    const url = match[0].replace(TRAILING, '');
    const start = match.index;
    if (col >= start && col < start + url.length) return url;
  }
  return undefined;
}

/** Logische Zeile (über Umbrüche hinweg) und Spalte für eine Pufferposition. */
function logicalLine(term: Terminal, row: number, col: number): { text: string; col: number } {
  const buffer = term.buffer.active;
  let start = row;
  while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
  let end = row;
  while (buffer.getLine(end + 1)?.isWrapped) end++;
  let text = '';
  let offset = 0;
  for (let r = start; r <= end; r++) {
    const part = buffer.getLine(r)?.translateToString(r < end) ?? '';
    if (r === row) offset = text.length + col;
    text += part;
  }
  return { text, col: offset };
}

export function bindLinks(term: Terminal, screen: HTMLElement, open: (url: string) => void): void {
  const cellAt = (e: MouseEvent): { row: number; col: number } | undefined => {
    const rect = screen.getBoundingClientRect();
    if (!term.cols || !term.rows || rect.width === 0) return undefined;
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * term.cols);
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * term.rows);
    if (col < 0 || row < 0 || col >= term.cols || row >= term.rows) return undefined;
    return { row: term.buffer.active.viewportY + row, col };
  };
  const linkAt = (e: MouseEvent): string | undefined => {
    const cell = cellAt(e);
    if (!cell) return undefined;
    const { text, col } = logicalLine(term, cell.row, cell.col);
    return urlAt(text, col);
  };

  screen.addEventListener('click', (e) => {
    if (term.hasSelection()) return;
    const url = linkAt(e);
    if (url) open(url);
  });
  screen.addEventListener('mousemove', (e) => {
    screen.style.cursor = linkAt(e) ? 'pointer' : '';
  });
}
