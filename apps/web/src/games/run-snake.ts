import type { KeyValueStore } from '../vfs/workspace.ts';
import { newGame, render, step, tickMs, turn, type Dir, type Random } from './snake.ts';

/** Tasten, die ein Spiel versteht (unabhängig vom Tastaturlayout, siehe game-screen.ts). */
export type GameKey = Dir | 'quit' | 'confirm';

/**
 * Bildschirm für Spiele (#32): eigener Terminal-Bildschirm, auf dem nichts anderes
 * erscheint, und Tasten nur für das Spiel. Im Browser `terminal/game-screen.ts`,
 * im Test ein Fake.
 */
export interface GameScreen {
  /** Wechselt in den Spielbildschirm und liefert seine Größe in Zeichen. */
  enter(): { cols: number; rows: number };
  draw(lines: string[]): void;
  /** Meldet Tasten (und Klick auf ✕ als 'quit'); gibt eine Abmeldefunktion zurück. */
  onKey(handler: (key: GameKey) => void): () => void;
  /** Zurück zum normalen Terminal. */
  leave(): void;
}

export const HIGHSCORE_KEY = 'maxim-os:snake:highscore';

export interface SnakeOptions {
  signal?: AbortSignal;
  storage?: KeyValueStore;
  rand?: Random;
  /** Wartet zwischen zwei Schritten (im Test sofort). */
  delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export type SnakeResult =
  { ok: true; score: number; highscore: number } | { ok: false; reason: 'too-small' };

function readHighscore(storage: KeyValueStore | undefined): number {
  try {
    const n = Number(storage?.getItem(HIGHSCORE_KEY));
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Spielt Snake, bis der Spieler beendet (Esc, Ctrl+C, ✕) oder abgebrochen wird. */
export async function runSnake(
  screen: GameScreen,
  options: SnakeOptions = {},
): Promise<SnakeResult> {
  const { signal, storage } = options;
  const rand = options.rand ?? Math.random;
  const delay =
    options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let highscore = readHighscore(storage);

  const { cols, rows } = screen.enter();
  // Kopfzeile, zwei Ränder, Hilfezeile; jede Zelle zwei Zeichen breit
  const width = Math.min(30, Math.floor((cols - 2) / 2));
  const height = Math.min(20, rows - 4);
  if (width < 10 || height < 5) {
    screen.leave();
    return { ok: false, reason: 'too-small' };
  }

  let state = newGame(width, height, rand);
  let best = 0;
  let quit = false;
  const off = screen.onKey((key) => {
    if (key === 'quit') quit = true;
    else if (key === 'confirm') {
      if (state.over) state = newGame(width, height, rand);
    } else state = turn(state, key);
  });

  const saveHighscore = (): void => {
    if (state.score <= highscore) return;
    highscore = state.score;
    try {
      storage?.setItem(HIGHSCORE_KEY, String(highscore));
    } catch {
      // Highscore ist optional
    }
  };

  try {
    while (!quit && !signal?.aborted) {
      screen.draw(render(state, { highscore }));
      await delay(state.over ? 50 : tickMs(state.score), signal);
      if (quit || signal?.aborted) break;
      if (!state.over) {
        state = step(state, rand);
        best = Math.max(best, state.score);
        if (state.over) saveHighscore();
      }
    }
    saveHighscore();
  } finally {
    off();
    screen.leave();
  }
  return { ok: true, score: best, highscore };
}
