/**
 * Touch-Scrolling für die Terminal-Ausgabe. xterm.js 6 scrollt auf iOS Safari
 * nicht per Wischen; Safari versucht stattdessen die fixierte Seite zu
 * verschieben (Wackeln). Wir übernehmen die Geste selbst und scrollen zeilenweise.
 */

/** Rechnet Fingerbewegung (px) in ganze Zeilen um und merkt sich den Rest. */
export class LineAccumulator {
  private rest = 0;
  private readonly cell: number;

  constructor(cellHeight: number) {
    this.cell = cellHeight;
  }

  /** Finger nach unten (dy > 0) = ältere Ausgabe = nach oben scrollen (negativ). */
  feed(dy: number): number {
    if (this.cell <= 0) return 0;
    const total = this.rest + dy;
    const lines = Math.trunc(total / this.cell);
    this.rest = total - lines * this.cell;
    return lines === 0 ? 0 : -lines;
  }

  reset(): void {
    this.rest = 0;
  }
}

const DECAY_PER_MS = 0.996;
const MIN_SPEED = 0.03; // px/ms

/** Schwung nach dem Loslassen: Geschwindigkeit (px/ms) nach `dt` ms. */
export function momentumStep(velocity: number, dt: number): number {
  const next = velocity * DECAY_PER_MS ** dt;
  return Math.abs(next) < MIN_SPEED ? 0 : next;
}

export interface TouchScrollTarget {
  scrollLines(amount: number): void;
  /** Aktuelle Zeilenhöhe in px. */
  cellHeight(): number;
}

/**
 * Bindet Wisch-Scrolling an `root`. Gesten, die in `exclude` beginnen (z. B. der
 * horizontal scrollbaren Quick-Key-Leiste), bleiben beim Browser.
 */
export function bindTouchScroll(
  root: HTMLElement,
  target: TouchScrollTarget,
  exclude: (el: Element) => boolean,
): void {
  let tracking = false;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let acc = new LineAccumulator(1);
  let raf = 0;

  const stopMomentum = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  root.addEventListener(
    'touchstart',
    (e) => {
      stopMomentum();
      tracking = e.touches.length === 1 && !exclude(e.target as Element);
      if (!tracking) return;
      lastY = e.touches[0]!.clientY;
      lastT = e.timeStamp;
      velocity = 0;
      acc = new LineAccumulator(target.cellHeight());
    },
    { passive: true, capture: true },
  );

  root.addEventListener(
    'touchmove',
    (e) => {
      if (!tracking || e.touches.length !== 1) return;
      // Kein Seiten-Gummiband und kein xterm.js-eigenes Handling.
      e.preventDefault();
      e.stopPropagation();
      const y = e.touches[0]!.clientY;
      const dy = y - lastY;
      const dt = Math.max(1, e.timeStamp - lastT);
      lastY = y;
      lastT = e.timeStamp;
      velocity = 0.8 * (dy / dt) + 0.2 * velocity;
      const lines = acc.feed(dy);
      if (lines) target.scrollLines(lines);
    },
    { passive: false, capture: true },
  );

  const end = (): void => {
    if (!tracking) return;
    tracking = false;
    if (Math.abs(velocity) < MIN_SPEED * 3) return;
    let prev = performance.now();
    const step = (now: number): void => {
      const dt = now - prev;
      prev = now;
      const lines = acc.feed(velocity * dt);
      if (lines) target.scrollLines(lines);
      velocity = momentumStep(velocity, dt);
      raf = velocity ? requestAnimationFrame(step) : 0;
    };
    raf = requestAnimationFrame(step);
  };
  root.addEventListener('touchend', end, { capture: true });
  root.addEventListener('touchcancel', end, { capture: true });
}
