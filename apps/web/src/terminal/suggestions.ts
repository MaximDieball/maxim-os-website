import { findCommand } from '@maxim-os/shared';

/**
 * Command-Vorschläge auf dem Startscreen (#99), wie Beispiel-Prompts in Chat-Apps.
 * Nur Commands, die es in der Registry gibt: `minecraft` erscheint von selbst, sobald
 * der Command existiert.
 */
export interface StartSuggestion {
  command: string;
  hint: string;
}

export const START_SUGGESTIONS: readonly StartSuggestion[] = [
  { command: 'projects', hint: 'Meine Projekte' },
  { command: 'watchthis', hint: 'Film-Seite öffnen' },
  { command: 'snake', hint: 'Snake spielen' },
  { command: 'minecraft', hint: 'Minecraft-Server' },
];

/** Vorschläge, deren Command registriert ist. */
export const availableSuggestions = (
  items: readonly StartSuggestion[] = START_SUGGESTIONS,
): StartSuggestion[] => items.filter((s) => findCommand(s.command) !== undefined);

export interface Suggestions {
  /** Ausblenden, z. B. nach dem ersten Command. Endgültig. */
  dismiss(): void;
  /** Prüft nach Layoutänderungen, ob die Chips etwas überdecken würden. */
  update(): void;
}

/**
 * Baut die Chips (nur DOM-API und textContent, kein HTML aus Inhalten). Ein Klick
 * führt den Command aus; der Fokus bleibt in der Eingabe, damit die Tastatur offen bleibt.
 * `blocked` meldet, bis wohin (y in px, Viewport) Prompt und Ausgabe reichen.
 */
export function createSuggestions(
  container: HTMLElement,
  run: (command: string) => void,
  blocked: () => number,
  items: readonly StartSuggestion[] = availableSuggestions(),
): Suggestions {
  let dismissed = items.length === 0;
  container.replaceChildren(
    ...items.map((s) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'suggestion';
      button.dataset.command = s.command;
      button.setAttribute('aria-label', `${s.command} ausführen: ${s.hint}`);
      const cmd = document.createElement('span');
      cmd.className = 'suggestion-cmd';
      cmd.textContent = s.command;
      const hint = document.createElement('span');
      hint.className = 'suggestion-hint';
      hint.textContent = s.hint;
      button.append(cmd, hint);
      return button;
    }),
  );
  const keepFocus = (e: Event): void => e.preventDefault();
  container.addEventListener('pointerdown', keepFocus);
  container.addEventListener('mousedown', keepFocus);
  container.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button.suggestion');
    const command = button?.dataset.command;
    if (command) run(command);
  });

  const api: Suggestions = {
    dismiss() {
      dismissed = true;
      container.hidden = true;
    },
    update() {
      if (dismissed) return;
      // Erst zeigen, dann messen: überdeckt es Prompt oder Ausgabe, bleibt es weg.
      container.hidden = false;
      if (container.getBoundingClientRect().top < blocked()) container.hidden = true;
    },
  };
  container.hidden = true;
  return api;
}
