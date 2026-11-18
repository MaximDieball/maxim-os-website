import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { ShellOutput } from '../shell/shell.ts';
import { clean } from '../shell/format.ts';
import { stripAnsi } from '../shell/text.ts';
import type { LiveRegion } from './live.ts';

/** Prompt wie in einem modernen Linux-Terminal: user@host grün, Pfad blau. */
export function promptFor(cwd: string): string {
  return `\x1b[1;32mguest@maxim-os\x1b[22;39m:\x1b[1;34m${clean(cwd)}\x1b[22;39m$ `;
}

/** Farbpalette (schwarz/weiß mit Akzenten). CSS nutzt dieselben Werte (styles.css). */
export const THEME = {
  background: '#000000',
  foreground: '#e6e6e6',
  cursor: '#e6e6e6',
  cursorAccent: '#000000',
  selectionBackground: '#3a3d41',
  black: '#000000',
  red: '#ff6b6b',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e6e6e6',
  brightBlack: '#7a7a7a',
  brightRed: '#ff8787',
  brightGreen: '#86efac',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
} as const;

const NARROW_PX = 480;

export interface TerminalView {
  term: Terminal;
  output: ShellOutput;
  /** Passt Schriftgröße und Spalten an den Container an und scrollt nach unten. */
  fit(): void;
}

export function createTerminal(container: HTMLElement, live: LiveRegion): TerminalView {
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
    fontSize: fontSizeFor(container.clientWidth),
    lineHeight: 1.15,
    cursorBlink: false,
    cursorStyle: 'block',
    cursorInactiveStyle: 'none',
    // Eingabe läuft ausschließlich über das native <input> (Spike-Entscheidung, #15).
    disableStdin: true,
    scrollback: 2000,
    allowProposedApi: false,
    theme: THEME,
    drawBoldTextInBrightColors: false,
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  // Den Cursor zeichnet die Prompt-Zeile selbst (prompt-line.ts).
  term.write('\x1b[?25l');

  const fit = (): void => {
    const size = fontSizeFor(container.clientWidth);
    if (term.options.fontSize !== size) term.options.fontSize = size;
    fitAddon.fit();
    term.scrollToBottom();
  };

  const output: ShellOutput = {
    print(lines) {
      term.write(`${lines.join('\r\n')}\r\n`, () => term.scrollToBottom());
      live.announce(lines.map(stripAnsi).join('\n'));
    },
    clear() {
      term.write('\x1b[2J\x1b[3J\x1b[H');
      term.clear();
    },
    cols: () => term.cols,
  };

  return { term, output, fit };
}

function fontSizeFor(widthPx: number): number {
  return widthPx < NARROW_PX ? 13 : 15;
}
