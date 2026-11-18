/** Gemeinsame Schnittstelle beider Eingabevarianten (Spike: native vs. xterm). */
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
}

export type InputMode = 'native' | 'xterm';

export function inputModeFromUrl(search: string): InputMode {
  return new URLSearchParams(search).get('input') === 'xterm' ? 'xterm' : 'native';
}
