/** Matrix-Startanimation: Zeichen laufen von oben nach unten. Überspringbar. */

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789MAXIMOS<>/$#*+=';
const FRAME_MS = 33;

export interface MatrixOptions {
  durationMs?: number;
  /** Überspringen erzwingen (prefers-reduced-motion, ?boot=skip). */
  skip?: boolean;
}

export function shouldSkipBoot(search: string): boolean {
  return (
    new URLSearchParams(search).get('boot') === 'skip' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function runMatrix(canvas: HTMLCanvasElement, options: MatrixOptions = {}): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (options.skip || !ctx) {
    canvas.hidden = true;
    return Promise.resolve();
  }

  const duration = options.durationMs ?? 2200;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.scale(dpr, dpr);

  // Zeichengröße an die Breite anpassen: mobil weniger, dafür größere Spalten.
  const size = width < 480 ? 14 : 16;
  const columns = Math.ceil(width / size);
  const drops = Array.from({ length: columns }, () => Math.floor((Math.random() * -height) / size));
  ctx.font = `${size}px "JetBrains Mono", monospace`;

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
      if (now - started > duration) return finish();
      if (now - last >= FRAME_MS) {
        last = now;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(0, 0, width, height);
        for (let i = 0; i < columns; i++) {
          const y = drops[i]! * size;
          ctx.fillStyle = Math.random() > 0.95 ? '#d8ffe0' : '#39ff88';
          ctx.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!, i * size, y);
          drops[i] = y > height && Math.random() > 0.97 ? 0 : drops[i]! + 1;
        }
      }
      requestAnimationFrame(frame);
    };

    window.addEventListener('keydown', finish, true);
    window.addEventListener('pointerdown', finish, true);
    requestAnimationFrame(frame);
  });
}
