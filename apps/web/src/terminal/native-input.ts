import type { Shell } from '../shell/shell.ts';
import { sanitizeInput } from '../shell/text.ts';
import type { LineEditor } from './editor.ts';
import { PROMPT, type TerminalView } from './term.ts';

/**
 * Variante "native": xterm.js zeigt nur die Ausgabe, getippt wird in einem
 * eigenen, sichtbaren <input> unter der Ausgabe. Robust gegen IME/Autokorrektur.
 */
export function createNativeInput(
  form: HTMLFormElement,
  input: HTMLInputElement,
  view: TerminalView,
  shell: Shell,
): LineEditor {
  form.hidden = false;

  // xterm.js darf die Tastatur nicht an sich ziehen.
  const textarea = view.term.textarea;
  if (textarea) {
    textarea.readOnly = true;
    textarea.tabIndex = -1;
  }
  view.term.element?.addEventListener('focusin', () => input.focus());

  const submit = (): void => {
    const line = sanitizeInput(input.value);
    input.value = '';
    view.term.write(`${PROMPT}${line}\r\n`);
    shell.execute(line);
    input.focus();
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });

  const editor: LineEditor = {
    focus: () => input.focus({ preventScroll: true }),
    complete() {
      input.value = shell.complete(input.value);
      moveCaretToEnd(input);
    },
    historyPrev() {
      input.value = shell.history.prev(input.value);
      moveCaretToEnd(input);
    },
    historyNext() {
      input.value = shell.history.next();
      moveCaretToEnd(input);
    },
    interrupt() {
      view.term.write(`${PROMPT}${sanitizeInput(input.value)}^C\r\n`);
      input.value = '';
    },
    insert(text) {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.setRangeText(text, start, end, 'end');
    },
    clearScreen: () => view.output.clear(),
    start: () => editor.focus(),
  };

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

function moveCaretToEnd(input: HTMLInputElement): void {
  const end = input.value.length;
  input.setSelectionRange(end, end);
}
