import type { Terminal } from '@xterm/xterm';
import type { GameKey, GameScreen } from '../games/run-snake.ts';

/**
 * Spielbildschirm im Terminal (#32). Nutzt den alternativen Bildschirm von xterm.js:
 * Während des Spiels ist nur das Spiel zu sehen, danach ist die vorherige Ausgabe
 * unverändert wieder da. Tasten werden in der Capture-Phase abgefangen, damit sie weder
 * im Eingabefeld landen noch Browser-Aktionen auslösen (z. B. Kopieren bei Ctrl+C).
 */

/** Taste zu Spielaktion. `code` ist layoutunabhängig (WASD auch auf AZERTY usw.). */
export function gameKeyFor(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey'>,
): GameKey | undefined {
  if (e.ctrlKey && e.code === 'KeyC') return 'quit';
  switch (e.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Escape':
      return 'quit';
    case 'Enter':
    case ' ':
      return 'confirm';
  }
  switch (e.code) {
    case 'KeyW':
      return 'up';
    case 'KeyS':
      return 'down';
    case 'KeyA':
      return 'left';
    case 'KeyD':
      return 'right';
  }
  return undefined;
}

export function createGameScreen(
  term: Terminal,
  screenEl: HTMLElement | null,
  prompt: HTMLElement,
): GameScreen {
  let handler: ((key: GameKey) => void) | undefined;

  const onKeyDown = (e: KeyboardEvent): void => {
    // Browser-Kürzel mit Cmd (Mac) bleiben erlaubt, z. B. Cmd+R.
    if (e.metaKey) return;
    const key = gameKeyFor(e);
    // Alles andere schlucken, damit nichts ins (versteckte) Eingabefeld getippt wird.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (key) handler?.(key);
  };
  // ✕ oben links: Klick in die ersten Zellen der ersten Zeile beendet das Spiel.
  const onClick = (e: MouseEvent): void => {
    if (!screenEl || !term.cols || !term.rows) return;
    const rect = screenEl.getBoundingClientRect();
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * term.cols);
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * term.rows);
    if (row === 0 && col >= 0 && col <= 2) handler?.('quit');
  };

  return {
    enter() {
      // alternativer Bildschirm, Cursor aus, leeren
      term.write('\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J');
      prompt.style.visibility = 'hidden';
      window.addEventListener('keydown', onKeyDown, { capture: true });
      screenEl?.addEventListener('click', onClick);
      return { cols: term.cols, rows: term.rows };
    },
    draw(lines) {
      term.write(`\x1b[H${lines.map((l) => `${l}\x1b[K`).join('\r\n')}\x1b[J`);
    },
    onKey(h) {
      handler = h;
      return () => {
        if (handler === h) handler = undefined;
      };
    },
    leave() {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      screenEl?.removeEventListener('click', onClick);
      prompt.style.visibility = '';
      // zurück zum normalen Bildschirm; den Cursor zeichnet weiter die Prompt-Zeile
      term.write('\x1b[?1049l', () => term.scrollToBottom());
    },
  };
}
