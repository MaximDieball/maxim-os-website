import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';
import { runMatrix, shouldSkipBoot } from './boot/matrix.ts';
import { startscreenLines } from './boot/startscreen.ts';
import { withSuggestions } from './shell/suggest.ts';
import { createGameScreen } from './terminal/game-screen.ts';
import { browserStorage } from './vfs/workspace.ts';
import { FS_UNAVAILABLE, Shell } from './shell/shell.ts';
import { style } from './shell/text.ts';
import { createLiveRegion } from './terminal/live.ts';
import { createNativeInput } from './terminal/native-input.ts';
import { bindQuickKeys } from './terminal/quickkeys.ts';
import { createTerminal } from './terminal/term.ts';
import { bindTouchScroll } from './terminal/touch-scroll.ts';
import { trackVisualViewport } from './terminal/viewport.ts';
import { THEME as theme } from './theme/theme.ts';
import { loadWorkspace } from './vfs/load.ts';
import { loadGithub, loadReadme, sessionStore } from './profile/github.ts';

/** Touch-Gerät ohne feinen Zeiger oder sehr schmaler Bildschirm (SPEC 4a, #33). */
const isMobile = (): boolean =>
  (matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches) ||
  window.innerWidth < 500;

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

  // Snapshot parallel zur Animation laden; die Shell wartet bei Bedarf darauf.
  const workspace = loadWorkspace();

  const matrix = runMatrix(byId<HTMLCanvasElement>('matrix'), {
    skip: shouldSkipBoot(location.search),
    colors: theme.matrix,
  });

  // xterm.js misst Zeichen beim Öffnen: Schrift vorher laden.
  await Promise.allSettled([
    document.fonts.load(`15px "${theme.font.face}"`),
    document.fonts.load(`bold 15px "${theme.font.face}"`),
  ]);

  const view = createTerminal(termEl, createLiveRegion(byId('live')), theme);
  const editor = createNativeInput(
    form,
    input,
    view,
    (out) =>
      new Shell(out, workspace, {
        github: () => loadGithub({ storage: sessionStore() }),
        readme: (repo) => loadReadme(repo, { storage: sessionStore() }),
        openUrl: (url) => void window.open(url, '_blank', 'noopener,noreferrer'),
        gameScreen: () =>
          createGameScreen(view.term, termEl.querySelector<HTMLElement>('.xterm-screen'), form),
        isMobile,
        storage: browserStorage(),
      }),
  );
  // Klickbare Zeilen (z. B. Projekte) führen ihr Command aus, als wäre es getippt.
  view.onAction((command) => editor.run(command));

  trackVisualViewport(app, () => {
    view.fit();
    editor.redraw();
  });
  const quickkeys = byId('quickkeys');
  bindQuickKeys(quickkeys, () => editor);
  // Wischen über die Ausgabe scrollt den Verlauf (iOS Safari kann das mit xterm.js nicht selbst).
  const debugTouch =
    import.meta.env.DEV && new URLSearchParams(location.search).get('debug') === 'touch'
      ? (await import('./terminal/touch-debug.ts')).createTouchDebug(view.term)
      : undefined;
  bindTouchScroll(
    app,
    {
      scrollLines: (n) => view.term.scrollLines(n),
      cellHeight: () => {
        const screen = termEl.querySelector<HTMLElement>('.xterm-screen');
        const measured = screen && view.term.rows ? screen.clientHeight / view.term.rows : 0;
        // Fallback, falls das Element (noch) keine Höhe hat.
        return measured > 0 ? measured : (view.term.options.fontSize ?? 15) * 1.15;
      },
    },
    (el) => quickkeys.contains(el),
    debugTouch,
  );

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
  const start = withSuggestions(startscreenLines(view.term.cols, theme.logo));
  view.output.print(start.lines, start.actions);
  editor.start();
  document.documentElement.dataset.ready = 'true';
  void workspace.then((ws) => {
    if (!ws) editor.notify([style.yellow(FS_UNAVAILABLE)]);
    else if (ws.notice) editor.notify([style.yellow(ws.notice)]);
  });
  await matrix;
  document.documentElement.dataset.booted = 'true';
  editor.focus();
}

void boot();
