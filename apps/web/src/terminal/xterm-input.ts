import type { Shell } from '../shell/shell.ts';
import { MAX_INPUT_LENGTH, sanitizeInput } from '../shell/text.ts';
import type { LineEditor } from './editor.ts';
import { PROMPT, type TerminalView } from './term.ts';

/**
 * Variante "xterm": Eingabe direkt über xterm.js (onData) mit eigener Zeilenbearbeitung.
 * Nur für den Mobile-Spike; Zeilenbearbeitung bewusst minimal (kein Cursor links/rechts).
 */
export function createXtermInput(view: TerminalView, shell: Shell): LineEditor {
  const { term } = view;
  let buffer = '';

  const redraw = (): void => term.write(`\r\x1b[K${PROMPT}${buffer}`);
  const setBuffer = (value: string): void => {
    buffer = sanitizeInput(value);
    redraw();
  };

  const editor: LineEditor = {
    focus: () => term.focus(),
    complete: () => setBuffer(shell.complete(buffer)),
    historyPrev: () => setBuffer(shell.history.prev(buffer)),
    historyNext: () => setBuffer(shell.history.next()),
    interrupt() {
      term.write('^C\r\n');
      buffer = '';
      term.write(PROMPT);
    },
    insert(text) {
      const clean = sanitizeInput(text).slice(0, MAX_INPUT_LENGTH - buffer.length);
      buffer += clean;
      term.write(clean);
    },
    clearScreen() {
      view.output.clear();
      redraw();
    },
    start() {
      term.write(PROMPT);
      editor.focus();
    },
  };

  term.onData((data) => {
    switch (data) {
      case '\r': {
        const line = buffer;
        buffer = '';
        term.write('\r\n');
        shell.execute(line);
        term.write(PROMPT);
        return;
      }
      case '\x7f':
      case '\b':
        if (buffer) {
          buffer = buffer.slice(0, -1);
          term.write('\b \b');
        }
        return;
      case '\x1b[A':
        return editor.historyPrev();
      case '\x1b[B':
        return editor.historyNext();
      case '\t':
        return editor.complete();
      case '\x03':
        return editor.interrupt();
      case '\x0c':
        return editor.clearScreen();
    }
    if (data.startsWith('\x1b')) return; // andere Escape-Sequenzen ignorieren
    editor.insert(data.replace(/\r/g, ''));
  });

  return editor;
}
