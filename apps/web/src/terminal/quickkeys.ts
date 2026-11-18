import type { LineEditor } from './editor.ts';

/**
 * Quick-Key-Leiste über der Tastatur. Die Buttons nehmen der Eingabe nie den Fokus,
 * damit die Bildschirmtastatur offen bleibt.
 */
export function bindQuickKeys(bar: HTMLElement, getEditor: () => LineEditor | undefined): void {
  const keepFocus = (e: Event): void => e.preventDefault();
  bar.addEventListener('pointerdown', keepFocus);
  bar.addEventListener('mousedown', keepFocus);

  bar.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest('button');
    const editor = getEditor();
    if (!button || !editor) return;
    const insert = button.dataset.insert;
    if (insert) editor.insert(insert);
    else
      switch (button.dataset.key) {
        case 'tab':
          editor.complete();
          break;
        case 'up':
          editor.historyPrev();
          break;
        case 'down':
          editor.historyNext();
          break;
        case 'ctrlc':
          editor.interrupt();
          break;
      }
    editor.focus();
  });
}
