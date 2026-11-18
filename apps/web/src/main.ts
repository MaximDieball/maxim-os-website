import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';
import { runMatrix, shouldSkipBoot } from './boot/matrix.ts';
import { startscreenLines } from './boot/startscreen.ts';
import { Shell } from './shell/shell.ts';
import { createLiveRegion } from './terminal/live.ts';
import { createNativeInput } from './terminal/native-input.ts';
import { bindQuickKeys } from './terminal/quickkeys.ts';
import { createTerminal } from './terminal/term.ts';
import { trackVisualViewport } from './terminal/viewport.ts';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} fehlt`);
  return el as T;
}

async function boot(): Promise<void> {
  const app = byId<HTMLElement>('app');
  const termEl = byId<HTMLDivElement>('term');
  const form = byId<HTMLFormElement>('prompt');
  const input = byId<HTMLInputElement>('cmd');

  const matrix = runMatrix(byId<HTMLCanvasElement>('matrix'), {
    skip: shouldSkipBoot(location.search),
  });

  // xterm.js misst Zeichen beim Öffnen: Schrift vorher laden.
  await Promise.allSettled([
    document.fonts.load('15px "JetBrains Mono"'),
    document.fonts.load('bold 15px "JetBrains Mono"'),
  ]);

  const view = createTerminal(termEl, createLiveRegion(byId('live')));
  const editor = createNativeInput(form, input, view, (out) => new Shell(out));

  trackVisualViewport(app, () => {
    view.fit();
    editor.redraw();
  });
  bindQuickKeys(byId('quickkeys'), () => editor);

  // Tippen auf die Ausgabe fokussiert die Eingabe (außer beim Markieren).
  termEl.addEventListener('click', () => {
    if (!view.term.hasSelection()) editor.focus();
  });
  // Desktop: Tippen ohne Fokus landet trotzdem in der Eingabe.
  document.addEventListener('keydown', (e) => {
    if (document.activeElement !== input && !e.ctrlKey && !e.metaKey) {
      input.focus();
    }
  });

  // Startscreen sofort rendern: die Animation läuft darüber und gibt ihn frei.
  view.fit();
  view.output.print(startscreenLines(view.term.cols));
  editor.start();
  document.documentElement.dataset.ready = 'true';
  await matrix;
  document.documentElement.dataset.booted = 'true';
  editor.focus();
}

void boot();
