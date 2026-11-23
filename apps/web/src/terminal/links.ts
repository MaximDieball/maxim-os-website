import type { IMarker, Terminal } from '@xterm/xterm';
import type { LineAction } from '../shell/shell.ts';

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
function logicalLine(
  term: Terminal,
  row: number,
  col: number,
): { text: string; col: number; start: number } {
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
  return { text, col: offset, start };
}

/**
 * Klickbare Zeilen (#90). Jede Zeile hängt an einem xterm-Marker, der beim Scrollen
 * und Umbrechen mitwandert und verschwindet, wenn die Zeile aus dem Puffer fällt.
 */
export class LineActions {
  private entries: { marker: IMarker; action: LineAction }[] = [];

  add(marker: IMarker | undefined, action: LineAction): void {
    if (!marker) return;
    const first = !this.entries.some((e) => e.marker === marker);
    this.entries.push({ marker, action });
    if (first) {
      marker.onDispose(() => {
        this.entries = this.entries.filter((e) => e.marker !== marker);
      });
    }
  }

  /** Command für die logische Zeile, die in Pufferzeile `start` beginnt. */
  at(start: number, col: number): string | undefined {
    const hit = this.entries.find(
      (e) =>
        !e.marker.isDisposed &&
        e.marker.line === start &&
        col >= (e.action.from ?? 0) &&
        col < (e.action.to ?? Infinity),
    );
    return hit?.action.command;
  }

  clear(): void {
    for (const m of new Set(this.entries.map((e) => e.marker))) m.dispose();
    this.entries = [];
  }
}

export interface LinkHandlers {
  /** Öffnet einen http(s)-Link. */
  open(url: string): void;
  actions?: LineActions;
  /** Führt das Command einer klickbaren Zeile aus. */
  run?(command: string): void;
}

export function bindLinks(term: Terminal, screen: HTMLElement, handlers: LinkHandlers): void {
  const cellAt = (e: MouseEvent): { row: number; col: number } | undefined => {
    const rect = screen.getBoundingClientRect();
    if (!term.cols || !term.rows || rect.width === 0) return undefined;
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * term.cols);
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * term.rows);
    if (col < 0 || row < 0 || col >= term.cols || row >= term.rows) return undefined;
    return { row: term.buffer.active.viewportY + row, col };
  };
  type Target = { url: string } | { command: string };
  const targetAt = (e: MouseEvent): Target | undefined => {
    const cell = cellAt(e);
    if (!cell) return undefined;
    const { text, col, start } = logicalLine(term, cell.row, cell.col);
    const url = urlAt(text, col);
    if (url) return { url };
    // Nur auf Text klicken, nicht ins Leere rechts daneben
    if (col >= text.trimEnd().length) return undefined;
    const command = handlers.run ? handlers.actions?.at(start, col) : undefined;
    return command ? { command } : undefined;
  };

  screen.addEventListener('click', (e) => {
    if (term.hasSelection()) return;
    const target = targetAt(e);
    if (!target) return;
    if ('url' in target) handlers.open(target.url);
    else handlers.run?.(target.command);
  });
  screen.addEventListener('mousemove', (e) => {
    screen.style.cursor = targetAt(e) ? 'pointer' : '';
  });
}
