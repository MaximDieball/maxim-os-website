import { style } from '../shell/text.ts';

/**
 * Snake (#32): reine Spiellogik ohne Browser, damit sie gut testbar ist.
 * Das Spielfeld hat `width` × `height` Zellen; jede Zelle ist im Terminal zwei
 * Zeichen breit, damit sie ungefähr quadratisch aussieht.
 */

export type Dir = 'up' | 'down' | 'left' | 'right';
export interface Point {
  x: number;
  y: number;
}

export interface SnakeState {
  width: number;
  height: number;
  /** Kopf zuerst. */
  snake: Point[];
  dir: Dir;
  /** Zuletzt gewählte Richtung; gilt ab dem nächsten Schritt. */
  next: Dir;
  food: Point | undefined;
  score: number;
  over: boolean;
}

export type Random = () => number;

const DELTA: Record<Dir, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/** Futter auf eine zufällige freie Zelle; undefined, wenn keine mehr frei ist. */
function placeFood(width: number, height: number, snake: Point[], rand: Random): Point | undefined {
  const free: Point[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!snake.some((s) => s.x === x && s.y === y)) free.push({ x, y });
    }
  }
  if (free.length === 0) return undefined;
  return free[Math.min(free.length - 1, Math.floor(rand() * free.length))];
}

export function newGame(width: number, height: number, rand: Random = Math.random): SnakeState {
  const y = Math.floor(height / 2);
  const x = Math.floor(width / 3);
  const snake = [
    { x, y },
    { x: x - 1, y },
    { x: x - 2, y },
  ];
  return {
    width,
    height,
    snake,
    dir: 'right',
    next: 'right',
    food: placeFood(width, height, snake, rand),
    score: 0,
    over: false,
  };
}

/** Neue Richtung; direkt umkehren ist nicht erlaubt (man würde sich selbst beißen). */
export function turn(state: SnakeState, dir: Dir): SnakeState {
  if (state.over || dir === OPPOSITE[state.dir]) return state;
  return { ...state, next: dir };
}

/** Ein Schritt: bewegen, fressen und wachsen oder an Wand bzw. sich selbst scheitern. */
export function step(state: SnakeState, rand: Random = Math.random): SnakeState {
  if (state.over) return state;
  const dir = state.next;
  const head = state.snake[0]!;
  const next = { x: head.x + DELTA[dir].x, y: head.y + DELTA[dir].y };
  const eats = state.food !== undefined && same(next, state.food);
  // Das Schwanzende rückt nach, außer die Schlange wächst gerade
  const body = eats ? state.snake : state.snake.slice(0, -1);
  const hitsWall = next.x < 0 || next.y < 0 || next.x >= state.width || next.y >= state.height;
  if (hitsWall || body.some((p) => same(p, next))) return { ...state, dir, over: true };

  const snake = [next, ...body];
  if (!eats) return { ...state, dir, snake };
  const food = placeFood(state.width, state.height, snake, rand);
  // Kein Platz mehr für Futter: Spielfeld voll, das Spiel ist gewonnen und vorbei
  return { ...state, dir, snake, food, score: state.score + 1, over: food === undefined };
}

/** Wartezeit pro Schritt: wird mit dem Score langsam schneller. */
export const tickMs = (score: number): number => Math.max(60, 130 - score * 3);

export interface RenderInfo {
  highscore: number;
}

/** Spielfeld als Terminal-Zeilen (mit Farben). Zeile 0 beginnt mit dem ✕ zum Beenden. */
export function render(state: SnakeState, info: RenderInfo): string[] {
  const head = state.snake[0]!;
  const best = Math.max(info.highscore, state.score);
  const max = state.width * 2 + 2;
  const x = style.red('✕');
  const name = style.bold(style.cyan('SNAKE'));
  const score = style.bold(String(state.score));
  // Volle Kopfzeile, sonst kompakt; nie breiter als das Spielfeld
  const top =
    [
      {
        plain: `✕  SNAKE  Score ${state.score}  Highscore ${best}`,
        text: `${x}  ${name}  Score ${score}  ${style.dim(`Highscore ${best}`)}`,
      },
      {
        plain: `✕ SNAKE ${state.score} · Best ${best}`,
        text: `${x} ${name} ${score} ${style.dim(`· Best ${best}`)}`,
      },
      { plain: `✕ SNAKE ${state.score}`, text: `${x} ${name} ${score}` },
    ].find((v) => v.plain.length <= max)?.text ?? `${x} ${score}`;
  const border = `+${'-'.repeat(state.width * 2)}+`;
  const rows: string[] = [];
  for (let y = 0; y < state.height; y++) {
    let row = '';
    for (let x = 0; x < state.width; x++) {
      if (x === head.x && y === head.y) row += style.bold(style.cyan('@ '));
      else if (state.snake.some((p) => p.x === x && p.y === y)) row += style.green('o ');
      else if (state.food && state.food.x === x && state.food.y === y) row += style.yellow('* ');
      else row += '  ';
    }
    rows.push(`|${row}|`);
  }
  // Keine Zeile darf breiter als das Spielfeld sein, sonst bricht sie um und schiebt
  // die Kopfzeile (mit ✕) aus dem Bild.
  const fit = (...variants: string[]): string =>
    variants.find((v) => v.length <= max) ?? variants.at(-1)!.slice(0, max);
  const help = state.over
    ? `${style.bold(style.red('GAME OVER'))}  ${fit('Enter: nochmal · Esc: beenden', 'Enter: nochmal', '').slice(0, Math.max(0, max - 11))}`
    : style.dim(
        fit(
          'Pfeile/WASD lenken · Esc, Ctrl+C oder ✕ beendet',
          'Pfeile/WASD · Esc beendet',
          'Esc beendet',
        ),
      );
  return [top, style.dim(border), ...rows, style.dim(border), help];
}
