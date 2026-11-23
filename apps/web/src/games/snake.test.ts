import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../shell/text.ts';
import { newGame, render, step, tickMs, turn, type SnakeState } from './snake.ts';

/** Zufall, der immer die erste freie Zelle wählt. */
const first = () => 0;

describe('snake logic', () => {
  it('starts with a snake of three moving right and food on a free cell', () => {
    const s = newGame(10, 8, first);
    expect(s.snake).toHaveLength(3);
    expect(s.dir).toBe('right');
    expect(s.food).toBeDefined();
    expect(s.snake.some((p) => p.x === s.food!.x && p.y === s.food!.y)).toBe(false);
  });

  it('moves one cell per step and keeps its length', () => {
    const s = step(newGame(10, 8, first), first);
    expect(s.snake[0]).toEqual({ x: 4, y: 4 });
    expect(s.snake).toHaveLength(3);
  });

  it('ignores turning straight back', () => {
    const s = turn(newGame(10, 8, first), 'left');
    expect(s.next).toBe('right');
    expect(turn(s, 'up').next).toBe('up');
  });

  it('grows and scores when eating', () => {
    const s0 = newGame(10, 8, first);
    const s: SnakeState = { ...s0, food: { x: 4, y: 4 } };
    const s1 = step(s, first);
    expect(s1.score).toBe(1);
    expect(s1.snake).toHaveLength(4);
    expect(s1.food).toBeDefined();
  });

  it('ends at the wall', () => {
    let s = turn(newGame(10, 8, first), 'up');
    for (let i = 0; i < 10; i++) s = step(s, first);
    expect(s.over).toBe(true);
  });

  it('ends when biting itself', () => {
    const s: SnakeState = {
      ...newGame(10, 8, first),
      snake: [
        { x: 5, y: 5 },
        { x: 5, y: 6 },
        { x: 4, y: 6 },
        { x: 4, y: 5 },
        { x: 4, y: 4 },
      ],
      dir: 'up',
      next: 'left',
      food: { x: 0, y: 0 },
    };
    expect(step(s, first).over).toBe(true);
  });

  it('speeds up with the score, down to a minimum', () => {
    expect(tickMs(0)).toBeGreaterThan(tickMs(10));
    expect(tickMs(1000)).toBe(60);
  });

  it('renders the board with ✕, score and highscore within its width', () => {
    const lines = render(newGame(16, 8, first), { highscore: 7 }).map(stripAnsi);
    expect(lines[0]).toMatch(/^✕ +SNAKE +Score 0 +Highscore 7/);
    expect(lines).toHaveLength(8 + 4);
    for (const l of lines.slice(1, -1)) expect(l).toHaveLength(34);
    // schmal: kompakt, Highscore bleibt
    expect(stripAnsi(render(newGame(10, 8, first), { highscore: 7 })[0]!)).toBe(
      '✕ SNAKE 0 · Best 7',
    );
    expect(lines.join('\n')).toContain('@');
    expect(lines.at(-1)).toContain('Esc');
  });

  it('never renders a line wider than the board (no wrapping on phones)', () => {
    for (const over of [false, true]) {
      const lines = render({ ...newGame(10, 6, first), over, score: 123 }, { highscore: 4567 });
      for (const l of lines.map(stripAnsi)) expect(l.length).toBeLessThanOrEqual(22);
    }
  });

  it('shows game over with restart hint', () => {
    const lines = render({ ...newGame(10, 8, first), over: true }, { highscore: 0 }).map(stripAnsi);
    expect(lines.at(-1)).toContain('GAME OVER');
  });
});
