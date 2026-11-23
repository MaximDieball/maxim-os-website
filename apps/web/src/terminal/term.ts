import { FitAddon } from '@xterm/addon-fit';
import { bindLinks, LineActions } from './links.ts';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { ShellOutput } from '../shell/shell.ts';
import { clean } from '../shell/format.ts';
import { THEME, type Theme } from '../theme/theme.ts';
import { stripAnsi } from '../shell/text.ts';
import type { LiveRegion } from './live.ts';

/** Prompt wie in einem modernen Linux-Terminal: user@host grün, Pfad blau. */
export function promptFor(cwd: string): string {
  return `\x1b[1;32mguest@maxim-os\x1b[22;39m:\x1b[1;34m${clean(cwd)}\x1b[22;39m$ `;
}

/** Unterhalb dieser Breite (px) gilt die schmale Schriftgröße des Themes. */
const NARROW_PX = 480;

export interface TerminalView {
  term: Terminal;
  output: ShellOutput;
  /** Setzt, was ein Klick auf eine klickbare Zeile ausführt (#90). */
  onAction(run: (command: string) => void): void;
  /** Passt Schriftgröße und Spalten an den Container an und scrollt nach unten. */
  fit(): void;
}

export function createTerminal(
  container: HTMLElement,
  live: LiveRegion,
  theme: Theme = THEME,
): TerminalView {
  const fontSizeFor = (widthPx: number): number =>
    widthPx < NARROW_PX ? theme.font.size.narrow : theme.font.size.wide;
  const term = new Terminal({
    fontFamily: theme.font.family,
    fontSize: fontSizeFor(container.clientWidth),
    lineHeight: theme.font.lineHeight,
    // Der Terminal-Hintergrund ist durchsichtig: der Text liegt auf der Glasfläche.
    allowTransparency: true,
    cursorBlink: false,
    cursorStyle: 'block',
    cursorInactiveStyle: 'none',
    // Eingabe läuft ausschließlich über das native <input> (Spike-Entscheidung, #15).
    disableStdin: true,
    scrollback: 2000,
    allowProposedApi: false,
    theme: theme.term,
    drawBoldTextInBrightColors: false,
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  term.open(container);
  // Links (http/https) per Klick bzw. Tippen in einem neuen Tab öffnen, ohne Zugriff auf diese Seite.
  const screenEl = container.querySelector<HTMLElement>('.xterm-screen');
  const actions = new LineActions();
  let runAction: ((command: string) => void) | undefined;
  if (screenEl)
    bindLinks(term, screenEl, {
      open: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
      actions,
      run: (command) => runAction?.(command),
    });
  // Den Cursor zeichnet die Prompt-Zeile selbst (prompt-line.ts).
  term.write('\x1b[?25l');

  const fit = (): void => {
    const size = fontSizeFor(container.clientWidth);
    if (term.options.fontSize !== size) term.options.fontSize = size;
    fitAddon.fit();
    term.scrollToBottom();
  };

  const output: ShellOutput = {
    print(lines, lineActions) {
      if (!lineActions?.some(Boolean)) {
        term.write(`${lines.join('\r\n')}\r\n`, () => term.scrollToBottom());
      } else {
        // Zeilenweise schreiben und vor jeder klickbaren Zeile einen Marker setzen.
        lines.forEach((line, i) => {
          const action = lineActions[i];
          if (action) {
            term.write('', () => {
              const marker = term.registerMarker(0);
              for (const a of Array.isArray(action) ? action : [action]) actions.add(marker, a);
            });
          }
          term.write(`${line}\r\n`);
        });
        term.write('', () => term.scrollToBottom());
      }
      live.announce(lines.map(stripAnsi).join('\n'));
    },
    clear() {
      actions.clear();
      term.write('\x1b[2J\x1b[3J\x1b[H');
      term.clear();
    },
    cols: () => term.cols,
  };

  return {
    term,
    output,
    fit,
    onAction: (run) => {
      runAction = run;
    },
  };
}
