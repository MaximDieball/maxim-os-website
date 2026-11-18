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

/** Beobachtungen für die Diagnose-Anzeige (?debug=touch, nur Dev). */
export interface TouchScrollDebug {
  event(type: string, info: Record<string, unknown>): void;
}

/**
 * Wisch-Scrolling für alles innerhalb von `root`. Die Listener hängen am
 * `window` in der Capture-Phase, laufen also vor allen anderen (auch vor der
 * Gestenerkennung, die xterm.js 6 am `document` registriert) und übernehmen die
 * Geste komplett. Gesten, die in `exclude` beginnen (z. B. der horizontal
 * scrollbaren Quick-Key-Leiste), bleiben beim Browser.
 */
export function bindTouchScroll(
  root: HTMLElement,
  target: TouchScrollTarget,
  exclude: (el: Element) => boolean,
  debug?: TouchScrollDebug,
): void {
  let tracking = false;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let acc = new LineAccumulator(1);
  let raf = 0;

  const inside = (e: TouchEvent): boolean => {
    const el = e.target instanceof Element ? e.target : null;
    return !!el && root.contains(el) && !exclude(el);
  };
  const scroll = (lines: number): void => {
    if (!lines) return;
    target.scrollLines(lines);
    debug?.event('scroll', { lines });
  };
  const stopMomentum = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  window.addEventListener(
    'touchstart',
    (e) => {
      stopMomentum();
      tracking = e.touches.length === 1 && inside(e);
      debug?.event('touchstart', { tracking, cell: target.cellHeight() });
      if (!tracking) return;
      e.stopPropagation(); // xterm.js-Gesten sollen nichts davon sehen
      lastY = e.touches[0]!.clientY;
      lastT = e.timeStamp;
      velocity = 0;
      acc = new LineAccumulator(target.cellHeight());
    },
    { passive: true, capture: true },
  );

  window.addEventListener(
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
      debug?.event('touchmove', { dy: Math.round(dy), prevented: e.defaultPrevented });
      scroll(acc.feed(dy));
    },
    { passive: false, capture: true },
  );

  const end = (e: TouchEvent): void => {
    if (!tracking) return;
    tracking = false;
    e.stopPropagation();
    debug?.event(e.type, { velocity: Math.round(velocity * 100) / 100 });
    if (Math.abs(velocity) < MIN_SPEED * 3) return;
    let prev = performance.now();
    const step = (now: number): void => {
      const dt = now - prev;
      prev = now;
      scroll(acc.feed(velocity * dt));
      velocity = momentumStep(velocity, dt);
      raf = velocity ? requestAnimationFrame(step) : 0;
    };
    raf = requestAnimationFrame(step);
  };
  window.addEventListener('touchend', end, { capture: true });
  window.addEventListener('touchcancel', end, { capture: true });
}
