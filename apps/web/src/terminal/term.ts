import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { ShellOutput } from '../shell/shell.ts';
import { stripAnsi } from '../shell/text.ts';
import type { LiveRegion } from './live.ts';

export const PROMPT = '\x1b[32mguest@maxim-os\x1b[39m:\x1b[36m/\x1b[39m$ ';

const NARROW_PX = 480;

export interface TerminalView {
  term: Terminal;
  output: ShellOutput;
  /** Passt Schriftgröße und Spalten an den Container an und scrollt nach unten. */
  fit(): void;
}

export function createTerminal(
  container: HTMLElement,
  live: LiveRegion,
  withStdin: boolean,
): TerminalView {
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
    fontSize: fontSizeFor(container.clientWidth),
    lineHeight: 1.15,
    cursorBlink: false,
    cursorStyle: 'block',
    cursorInactiveStyle: 'none',
    disableStdin: !withStdin,
    scrollback: 2000,
    allowProposedApi: false,
    theme: {
      background: '#0b0f0c',
      foreground: '#c8facc',
      cursor: '#39ff88',
      green: '#39ff88',
      cyan: '#5ee6d0',
      brightBlack: '#5f7f66',
      selectionBackground: '#2a4a33',
    },
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);

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
