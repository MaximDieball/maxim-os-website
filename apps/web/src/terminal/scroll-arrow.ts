import type { Terminal } from '@xterm/xterm';

/**
 * Pfeil nach unten (#101): sichtbar, solange die Ansicht nicht ganz unten steht (nach
 * einer langen Ausgabe, Mausrad oder Wischen). Ein Klick scrollt zum Prompt. Der Pfeil
 * nimmt der Eingabe nie den Fokus, damit die Bildschirmtastatur offen bleibt.
 */
export function bindScrollArrow(
  term: Terminal,
  panel: HTMLElement,
  button: HTMLElement,
  onClick: () => void,
): void {
  const update = (): void => {
    const b = term.buffer.active;
    // Im Spielbildschirm (alternativer Puffer) gibt es nichts zu scrollen
    button.hidden = b.type === 'alternate' || b.viewportY >= b.baseY;
    if (button.hidden) return;
    // Eigene Ebene über dem (unsichtbaren) Eingabefeld: Position aus dem Panel berechnen,
    // unten in der Mitte.
    const r = panel.getBoundingClientRect();
    button.style.left = `${Math.round(r.left + r.width / 2)}px`;
    button.style.top = `${Math.round(r.bottom - button.offsetHeight - 14)}px`;
  };
  term.onScroll(update);
  term.onRender(update);
  term.onWriteParsed(update);

  const keepFocus = (e: Event): void => e.preventDefault();
  button.addEventListener('pointerdown', keepFocus);
  button.addEventListener('mousedown', keepFocus);
  button.addEventListener('click', (e) => {
    // Nicht bis zum Terminal durchreichen (dort würde der Klick als Link gelesen)
    e.stopPropagation();
    term.scrollToBottom();
    update();
    onClick();
  });
  update();
}
