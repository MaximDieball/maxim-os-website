import type { Shell, ShellOutput } from '../shell/shell.ts';
import { sanitizeInput } from '../shell/text.ts';
import type { LineEditor } from './editor.ts';
import { renderPromptLine, type PromptState } from './prompt-line.ts';
import { promptFor, type TerminalView } from './term.ts';

/**
 * Eingabe über ein natives <input> (Spike-Entscheidung #15: robust gegen IME,
 * Autokorrektur und Diktat). Das Feld ist unsichtbar und liegt über der aktuellen
 * Prompt-Zeile; xterm.js zeichnet Prompt, Text und Cursor selbst in den Terminal-Fluss.
 */
export function createNativeInput(
  form: HTMLFormElement,
  input: HTMLInputElement,
  view: TerminalView,
  createShell: (out: ShellOutput) => Shell,
): LineEditor {
  const { term } = view;
  form.hidden = false;

  // xterm.js darf die Tastatur nicht an sich ziehen.
  const textarea = term.textarea;
  if (textarea) {
    textarea.readOnly = true;
    textarea.tabIndex = -1;
  }
  term.element?.addEventListener('focusin', () => input.focus());

  /** Prompt steht gerade als letzte Zeile im Terminal. */
  let shown = false;
  /** Cursor-Zeile des letzten Renderns, relativ zum Prompt-Anfang. */
  let rows = 0;
  let last = '';
  let lastState: PromptState = { value: '', caret: 0, focused: false };
  /** Ein Command läuft gerade (Server-Anfrage): kein Prompt, Ctrl+C bricht ab. */
  let running: AbortController | undefined;
  const prompt = (): string => promptFor(shell.cwd);

  const state = (focused = document.activeElement === input): PromptState => ({
    value: input.value,
    caret: input.selectionStart ?? input.value.length,
    focused,
  });

  /** Legt das unsichtbare Input-Feld über die Zeile, in der der Cursor steht. */
  const placeInput = (): void => {
    const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
    if (!screen || term.rows === 0) return;
    const cell = screen.clientHeight / term.rows;
    const top = screen.getBoundingClientRect().top - form.offsetParent!.getBoundingClientRect().top;
    form.style.setProperty(
      '--prompt-top',
      `${Math.round(top + term.buffer.active.cursorY * cell)}px`,
    );
    form.style.setProperty('--prompt-h', `${Math.round(cell)}px`);
  };

  const draw = (s: PromptState = state()): void => {
    if (running) return;
    const p = prompt();
    const r = renderPromptLine(p, s, term.cols, shown ? rows : 0);
    const key = `${term.cols}|${s.focused}|${s.caret}|${p}|${s.value}`;
    if (shown && key === last) return;
    last = key;
    lastState = s;
    shown = true;
    rows = r.rows;
    term.write(r.seq, () => {
      term.scrollToBottom();
      placeInput();
    });
  };

  /** Schließt die aktuelle Zeile ab (ohne Cursor), z. B. vor einer Ausgabe. */
  const commit = (suffix = ''): void => {
    if (!shown) return;
    // Den zuletzt gezeichneten Inhalt abschließen (das Input-Feld kann schon leer sein).
    const r = renderPromptLine(prompt(), { ...lastState, focused: false }, term.cols, rows);
    term.write(`${r.seq}${suffix}\r\n`);
    shown = false;
  };

  // Ausgaben laufen über diesen Kanal, damit sie nie mitten im Prompt landen.
  const out: ShellOutput = {
    print(lines) {
      commit();
      view.output.print(lines);
    },
    clear() {
      shown = false;
      view.output.clear();
    },
    cols: () => view.output.cols(),
  };
  const shell = createShell(out);

  const setValue = (value: string): void => {
    input.value = value;
    input.setSelectionRange(value.length, value.length);
    draw();
  };

  /** Zeilen, die abgeschickt wurden, während noch ein Command lief (wie Type-ahead in bash). */
  const queue: string[] = [];

  const run = (line: string): void => {
    const controller = new AbortController();
    running = controller;
    void shell.execute(line, controller.signal).finally(() => {
      if (running !== controller) return; // per Ctrl+C abgebrochen
      running = undefined;
      const next = queue.shift();
      if (next === undefined) return draw();
      // Gepufferte Zeile wie getippt anzeigen und ausführen.
      draw({ value: next, caret: next.length, focused: false });
      commit();
      run(next);
    });
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    input.focus({ preventScroll: true });
    const line = sanitizeInput(input.value);
    input.value = '';
    if (running) {
      queue.push(line);
      return;
    }
    // zuerst: die Zeile bleibt mit dem eingegebenen Command stehen
    draw({ value: line, caret: line.length, focused: false });
    commit();
    run(line);
  });

  const editor: LineEditor = {
    focus: () => input.focus({ preventScroll: true }),
    complete() {
      if (running) return;
      const before = input.value;
      void shell.complete(before).then((value) => {
        // Nur übernehmen, wenn inzwischen nicht weitergetippt wurde.
        if (input.value === before && value !== before) setValue(value);
        else draw();
      });
    },
    historyPrev: () => setValue(shell.history.prev(input.value)),
    historyNext: () => setValue(shell.history.next()),
    interrupt() {
      if (running) {
        // Laufende Anfrage abbrechen, gepufferte Zeilen verwerfen.
        running.abort();
        running = undefined;
        queue.length = 0;
        term.write('^C\r\n');
        draw();
        return;
      }
      commit('^C');
      input.value = '';
      draw();
    },
    insert(text) {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.setRangeText(sanitizeInput(text), start, end, 'end');
      draw();
    },
    clearScreen() {
      out.clear();
      draw();
    },
    start() {
      draw();
      editor.focus();
    },
    redraw() {
      if (!shown) return;
      // xterm.js hat die Zeile beim Resize neu umgebrochen: Zeilen mit neuer Breite zählen.
      rows = renderPromptLine(prompt(), lastState, term.cols, 0).rows;
      last = '';
      draw();
    },
  };

  input.addEventListener('input', () => {
    // Steuerzeichen (z. B. aus der Zwischenablage) gar nicht erst übernehmen.
    const clean = sanitizeInput(input.value);
    if (clean !== input.value) setValue(clean);
    else draw();
  });
  input.addEventListener('focus', () => draw());
  input.addEventListener('blur', () => draw(state(false)));
  // Caret per Pfeiltasten, Home/End oder Antippen verschoben.
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === input) draw();
  });
  input.addEventListener('keyup', () => draw());

  input.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'ArrowUp') editor.historyPrev();
    else if (e.key === 'ArrowDown') editor.historyNext();
    else if (e.key === 'Tab' && !e.shiftKey) editor.complete();
    // e.code ist layoutunabhängig. Mit markiertem Text bleibt Ctrl+C "Kopieren".
    else if (ctrl && e.code === 'KeyC' && input.selectionStart === input.selectionEnd)
      editor.interrupt();
    else if (ctrl && e.code === 'KeyL') editor.clearScreen();
    else return;
    e.preventDefault();
  });

  return editor;
}
