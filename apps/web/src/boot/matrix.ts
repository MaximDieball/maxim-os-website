/**
 * Matrix-Startanimation: Zuerst verdeckt dichter Code-Regen die ganze Seite,
 * dann fällt jede Spalte wie ein Vorhang nach unten und gibt den darunter
 * schon gerenderten Startscreen frei. Überspringbar (Taste, Tippen).
 */

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789MAXIMOS<>/$#*+=';
const FRAME_MS = 33;
/** Länge der leuchtenden Spur über dem Vorhang, in Zeichen. */
const TRAIL = 10;
/** Anteil der Zeichen im verdeckten Bereich, die pro Frame wechseln. */
const FLICKER = 0.04;

export interface MatrixOptions {
  durationMs?: number;
  /** Überspringen erzwingen (prefers-reduced-motion, ?boot=skip). */
  skip?: boolean;
  /** Farben: verdeckter Bereich (dunkel, mittel, hell), Spur (RGB) und Kopf. */
  colors?: {
    cover: [string, string, string];
    trail: readonly [number, number, number];
    head: string;
  };
}

const DEFAULT_COLORS = {
  cover: ['#0b3d1f', '#166534', '#4ade80'] as [string, string, string],
  trail: [74, 222, 128] as const,
  head: '#f0fff4',
};

export function shouldSkipBoot(search: string): boolean {
  return (
    new URLSearchParams(search).get('boot') === 'skip' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const glyph = (): string => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;

export function runMatrix(canvas: HTMLCanvasElement, options: MatrixOptions = {}): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (options.skip || !ctx) {
    canvas.hidden = true;
    return Promise.resolve();
  }

  const duration = options.durationMs ?? 2600;
  const colors = options.colors ?? DEFAULT_COLORS;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.scale(dpr, dpr);

  // Zeichengröße an die Breite anpassen: mobil weniger Spalten.
  const size = width < 480 ? 14 : 16;
  const cols = Math.ceil(width / size);
  const rows = Math.ceil(height / size);
  const font = `${size}px "JetBrains Mono", monospace`;

  // Verdeckter Bereich: ein volles Raster dunkler Zeichen auf Schwarz (offscreen gerendert).
  const cover = document.createElement('canvas');
  cover.width = canvas.width;
  cover.height = canvas.height;
  const cctx = cover.getContext('2d')!;
  cctx.scale(dpr, dpr);
  cctx.font = font;
  cctx.textBaseline = 'top';
  const drawCoverCell = (c: number, r: number): void => {
    cctx.fillStyle = '#000';
    cctx.fillRect(c * size, r * size, size, size);
    const bright = Math.random();
    cctx.fillStyle =
      bright > 0.92 ? colors.cover[2] : bright > 0.6 ? colors.cover[1] : colors.cover[0];
    cctx.fillText(glyph(), c * size, r * size);
  };
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) drawCoverCell(c, r);

  // Jede Spalte startet leicht versetzt und fällt unterschiedlich schnell.
  // Der Vorhang einer Spalte ist weg, wenn die Spur unten aus dem Bild ist.
  const travel = rows + TRAIL;
  const columns = Array.from({ length: cols }, () => {
    const delay = Math.random() * duration * 0.35;
    const speed = travel / ((duration - delay) * (0.55 + Math.random() * 0.45));
    return { delay, speed, trail: Array.from({ length: TRAIL }, glyph) };
  });

  ctx.font = font;
  ctx.textBaseline = 'top';

  // Bis zum ersten Frame deckt der CSS-Hintergrund (schwarz) ab.
  const paint = (elapsed: number): boolean => {
    for (let n = Math.floor(cols * rows * FLICKER); n > 0; n--) {
      drawCoverCell(Math.floor(Math.random() * cols), Math.floor(Math.random() * rows));
    }
    ctx.clearRect(0, 0, width, height);
    let finished = true;
    for (let c = 0; c < cols; c++) {
      const col = columns[c]!;
      const t = Math.max(0, elapsed - col.delay);
      // head: Zeile, bis zu der die Seite freigegeben ist (darunter: Spur, dann Vorhang).
      const head = Math.floor(t * col.speed) - TRAIL;
      if (head < rows) finished = false;
      const coverFrom = Math.max(0, head + TRAIL);
      if (coverFrom < rows) {
        ctx.drawImage(
          cover,
          c * size * dpr,
          coverFrom * size * dpr,
          size * dpr,
          (rows - coverFrom) * size * dpr,
          c * size,
          coverFrom * size,
          size,
          (rows - coverFrom) * size,
        );
      }
      // Spur: oben fast durchsichtig, unten (am Vorhang) hell mit weißem Kopf.
      if (Math.random() < 0.3) col.trail[Math.floor(Math.random() * TRAIL)] = glyph();
      for (let k = 0; k < TRAIL; k++) {
        const r = head + k;
        if (r < 0 || r >= rows) continue;
        const a = (k + 1) / TRAIL;
        ctx.fillStyle = `rgba(0, 0, 0, ${a * 0.85})`;
        ctx.fillRect(c * size, r * size, size, size);
        const [tr, tg, tb] = colors.trail;
        ctx.fillStyle = k === TRAIL - 1 ? colors.head : `rgba(${tr}, ${tg}, ${tb}, ${a})`;
        ctx.fillText(col.trail[k]!, c * size, r * size);
      }
    }
    return finished;
  };

  return new Promise((resolve) => {
    let done = false;
    let last = 0;
    const started = performance.now();

    const finish = (): void => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', finish, true);
      window.removeEventListener('pointerdown', finish, true);
      canvas.classList.add('done');
      window.setTimeout(() => {
        canvas.hidden = true;
      }, 320);
      resolve();
    };

    const frame = (now: number): void => {
      if (done) return;
      const elapsed = now - started;
      if (now - last >= FRAME_MS) {
        last = now;
        canvas.style.background = 'transparent';
        if (paint(elapsed) || elapsed > duration + 500) return finish();
      }
      requestAnimationFrame(frame);
    };

    window.addEventListener('keydown', finish, true);
    window.addEventListener('pointerdown', finish, true);
    requestAnimationFrame(frame);
  });
}
