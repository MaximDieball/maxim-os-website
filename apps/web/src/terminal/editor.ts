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
  /** Wird bei jedem abgeschickten Command aufgerufen (z. B. Vorschläge ausblenden, #99). */
  onSubmit?: (line: string) => void;
  /** Schreibt eine Zeile in die leere Eingabe, ohne sie auszuführen (#108). */
  prefill(line: string): boolean;
  /** Führt eine Zeile aus, als wäre sie getippt worden (klickbare Zeilen, #90). */
  run(line: string): void;
  /** Gibt einen Hinweis aus und zeichnet danach den Prompt neu. */
  notify(lines: string[]): void;
}
