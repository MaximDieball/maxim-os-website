/** Zeilen-Editor, den Shell, Quick-Keys und Tastaturkürzel bedienen. */
export interface LineEditor {
  focus(): void;
  complete(): void;
  historyPrev(): void;
  historyNext(): void;
  /** Ctrl+C: aktuelle Zeile verwerfen. */
  interrupt(): void;
  insert(text: string): void;
  clearScreen(): void;
  /** Zeigt den Prompt (nach dem Startscreen). */
  start(): void;
  /** Zeichnet die Prompt-Zeile neu (nach Größenänderung). */
  redraw(): void;
}
