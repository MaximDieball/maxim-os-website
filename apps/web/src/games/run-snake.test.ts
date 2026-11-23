import { describe, expect, it } from 'vitest';
import { HIGHSCORE_KEY, runSnake, type GameKey, type GameScreen } from './run-snake.ts';

function fakeScreen(cols = 80, rows = 24) {
  const frames: string[][] = [];
  let listener: ((k: GameKey) => void) | undefined;
  const state = { entered: 0, left: 0 };
  const screen: GameScreen = {
    enter: () => (state.entered++, { cols, rows }),
    draw: (l) => void frames.push(l),
    onKey: (h) => {
      listener = h;
      return () => (listener = undefined);
    },
    leave: () => void state.left++,
  };
  return { screen, frames, state, press: (k: GameKey) => listener?.(k) };
}

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('runSnake', () => {
  it('draws frames until the player quits and restores the terminal', async () => {
    const f = fakeScreen();
    let ticks = 0;
    const result = await runSnake(f.screen, {
      rand: () => 0,
      delay: async () => {
        if (++ticks === 3) f.press('quit');
      },
    });
    expect(result).toEqual({ ok: true, score: 0, highscore: 0 });
    expect(f.frames.length).toBeGreaterThanOrEqual(3);
    expect(f.state).toEqual({ entered: 1, left: 1 });
  });

  it('stops when cancelled (Ctrl+C from the shell)', async () => {
    const f = fakeScreen();
    const controller = new AbortController();
    let ticks = 0;
    await runSnake(f.screen, {
      signal: controller.signal,
      delay: async () => {
        if (++ticks === 2) controller.abort();
      },
    });
    expect(f.state.left).toBe(1);
  });

  it('saves a new highscore after game over and restarts on Enter', async () => {
    const f = fakeScreen();
    const storage = memoryStore({ [HIGHSCORE_KEY]: '0' });
    let ticks = 0;
    // Nach oben in die Wand fahren: Game over nach wenigen Schritten
    f.press('up');
    const result = await runSnake(f.screen, {
      storage,
      rand: () => 0,
      delay: async () => {
        ticks++;
        if (ticks === 1) f.press('up');
        if (ticks === 40) f.press('confirm');
        if (ticks === 42) f.press('quit');
      },
    });
    expect(result.ok).toBe(true);
    const texts = f.frames.map((fr) => fr.join('\n'));
    expect(texts.some((t) => t.includes('GAME OVER'))).toBe(true);
    // nach Enter wieder ein laufendes Spiel
    expect(texts.at(-1)).not.toContain('GAME OVER');
  });

  it('keeps the stored highscore and ignores garbage', async () => {
    const f = fakeScreen();
    const quitNow = async () => f.press('quit');
    const r1 = await runSnake(f.screen, {
      storage: memoryStore({ [HIGHSCORE_KEY]: '12' }),
      delay: quitNow,
    });
    expect(r1).toMatchObject({ highscore: 12 });
    const r2 = await runSnake(f.screen, {
      storage: memoryStore({ [HIGHSCORE_KEY]: 'x' }),
      delay: quitNow,
    });
    expect(r2).toMatchObject({ highscore: 0 });
  });

  it('refuses to start on a tiny terminal', async () => {
    const f = fakeScreen(20, 6);
    expect(await runSnake(f.screen)).toEqual({ ok: false, reason: 'too-small' });
    expect(f.state.left).toBe(1);
  });
});
