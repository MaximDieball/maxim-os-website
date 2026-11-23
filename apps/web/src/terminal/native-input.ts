import type { IMarker } from '@xterm/xterm';
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
    // xterm.js fokussiert seine Textarea bei jedem Klick. Getippt wird nur ins Input:
    // den Fokus gleich dorthin geben, statt ihn hin und her springen zu lassen.
    textarea.focus = () => input.focus({ preventScroll: true });
  }
  term.element?.addEventListener('focusin', () => input.focus());

  /** Prompt steht gerade als letzte Zeile im Terminal. */
  let shown = false;
  /** Cursor-Zeile des letzten Renderns, relativ zum Prompt-Anfang. */
  let rows = 0;
  let last = '';
  let lastState: PromptState = { value: '', caret: 0, focused: false };
  /** xterm-Marker am Anfang der aktuellen Prompt-Zeile (übersteht Reflow beim Resize). */
  let marker: IMarker | undefined;
  /** Ein Command läuft gerade (Server-Anfrage): kein Prompt, Ctrl+C bricht ab. */
  let running: AbortController | undefined;
  // Wartet die Shell auf eine Antwort (y/N), steht die Frage statt des Prompts in der Zeile.
  const prompt = (): string => shell.inputPrompt ?? promptFor(shell.cwd);

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

  /** `scroll`: zum Prompt springen (beim Tippen ja, nach einem Resize nur, wenn man unten war). */
  const draw = (s: PromptState = state(), scroll = true): void => {
    if (running && !shell.inputPrompt) return;
    const p = prompt();
    const r = renderPromptLine(p, s, term.cols, shown ? rows : 0);
    const key = `${term.cols}|${s.focused}|${s.caret}|${p}|${s.value}`;
    if (shown && key === last) return;
    last = key;
    lastState = s;
    if (!shown) {
      // Anfang der Prompt-Zeile merken (nach allen vorherigen Ausgaben), für redraw().
      term.write('', () => {
        marker?.dispose();
        marker = term.registerMarker(0);
      });
    }
    shown = true;
    rows = r.rows;
    term.write(r.seq, () => {
      if (scroll) term.scrollToBottom();
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
    print(lines, actions) {
      commit();
      view.output.print(lines, actions);
    },
    replaceLast(line) {
      view.output.replaceLast?.(line);
    },
    clear() {
      shown = false;
      view.output.clear();
    },
    cols: () => view.output.cols(),
  };
  const shell = createShell(out);
  shell.onInputRequest = () => draw();

  const setValue = (value: string): void => {
    input.value = value;
    input.setSelectionRange(value.length, value.length);
    draw();
  };

  /** Zeilen, die abgeschickt wurden, während noch ein Command lief (wie Type-ahead in bash). */
  const queue: string[] = [];

  /**
   * Lange Ausgaben (#101): Ist alles vom Command bis zum neuen Prompt höher als das
   * Terminal, bleibt die Ansicht am Command stehen statt ans Ende zu springen.
   * Der Pfeil (scroll-arrow.ts) führt dann nach unten.
   */
  const anchor = (getStart: () => IMarker | undefined): void => {
    term.write('', () => {
      // Erst hier lesen: der Marker entsteht selbst in einem Write-Callback
      const start = getStart();
      // Fertig gezeichnet: Tests und Screenreader-Hilfen können sich daran orientieren
      delete document.documentElement.dataset.busy;
      if (start && !start.isDisposed) {
        const b = term.buffer.active;
        if (b.baseY + b.cursorY - start.line + 1 > term.rows) term.scrollToLine(start.line);
      }
      start?.dispose();
    });
  };

  const run = (line: string): void => {
    const controller = new AbortController();
    running = controller;
    document.documentElement.dataset.busy = 'true';
    // Anfang der Command-Zeile merken (der Prompt-Marker wird beim nächsten Prompt ersetzt)
    let start: IMarker | undefined;
    term.write('', () => {
      if (!marker || marker.isDisposed) return;
      const b = term.buffer.active;
      start = term.registerMarker(marker.line - (b.baseY + b.cursorY));
    });
    void shell.execute(line, controller.signal).finally(() => {
      if (running !== controller) {
        // per Ctrl+C abgebrochen
        delete document.documentElement.dataset.busy;
        return void term.write('', () => start?.dispose());
      }
      running = undefined;
      const next = queue.shift();
      if (next === undefined) {
        draw();
        return anchor(() => start);
      }
      term.write('', () => start?.dispose());
      // Gepufferte Zeile wie getippt anzeigen und ausführen.
      draw({ value: next, caret: next.length, focused: false });
      commit();
      run(next);
    });
  };

  /** Schickt eine Zeile ab: wartende Frage beantworten, puffern oder ausführen. */
  const submit = (line: string): void => {
    if (shell.inputPrompt) {
      // Antwort auf eine Frage der Shell (z. B. reset: y/N).
      draw({ value: line, caret: line.length, focused: false });
      commit();
      shell.answer(line);
      return;
    }
    editor.onSubmit?.(line);
    if (running) {
      queue.push(line);
      return;
    }
    // zuerst: die Zeile bleibt mit dem eingegebenen Command stehen
    draw({ value: line, caret: line.length, focused: false });
    commit();
    run(line);
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    input.focus({ preventScroll: true });
    const line = sanitizeInput(input.value);
    input.value = '';
    submit(line);
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
    run(line) {
      // Klick während einer Frage (y/N) nicht als Antwort werten.
      if (shell.inputPrompt) return;
      // Angefangene Eingabe verwerfen: das Command steht statt ihrer in der Zeile.
      input.value = '';
      submit(sanitizeInput(line));
    },
    notify(lines) {
      out.print(lines);
      draw();
    },
    redraw() {
      if (!shown) return;
      const stick = view.atBottom();
      // Nach einem Resize hat xterm.js die Zeile evtl. neu (oder gar nicht) umgebrochen:
      // Zum gemerkten Anfang der Prompt-Zeile zurück, statt Zeilen zu schätzen.
      term.write('', () => {
        const b = term.buffer.active;
        rows =
          marker && !marker.isDisposed
            ? Math.max(0, b.baseY + b.cursorY - marker.line)
            : renderPromptLine(prompt(), lastState, term.cols, 0).rows;
        last = '';
        draw(undefined, stick);
      });
    },
  };

  input.addEventListener('input', () => {
    // Steuerzeichen (z. B. aus der Zwischenablage) gar nicht erst übernehmen.
    const clean = sanitizeInput(input.value);
    if (clean !== input.value) setValue(clean);
    else draw();
  });
  input.addEventListener('focus', () => draw());
  // Ein Klick ins Terminal nimmt dem Input kurz den Fokus, der Klick-Handler holt ihn zurück.
  // Erst neu zeichnen, wenn der Fokus wirklich weg ist (vermeidet Flackern des Cursors).
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement !== input) draw(state(false));
    }, 150);
  });
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
