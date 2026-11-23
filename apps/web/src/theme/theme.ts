import type { ITheme } from '@xterm/xterm';

/**
 * Design von MAXIM OS: "Glass" (Auswahl in #47). Dunkler Hintergrund mit weichen
 * Farbflächen, darauf eine große Glasfläche mit dem Terminal. Einzige Stelle für
 * Schrift und Farben im TypeScript; die CSS-Variablen in styles.css nutzen dieselben Werte.
 */

type Rgb = readonly [number, number, number];

export interface Theme {
  font: {
    /** CSS-Font-Family inkl. Fallbacks (SF Mono auf Apple-Geräten, sonst JetBrains Mono). */
    family: string;
    /** Mitgelieferte Schrift für document.fonts.load. */
    face: string;
    /** Schriftgröße in px: schmal (< 480 px Breite) und breit. */
    size: { narrow: number; wide: number };
    lineHeight: number;
  };
  /** xterm.js-Farben (ANSI-Palette). Hintergrund transparent: der Text liegt auf dem Glas. */
  term: ITheme;
  /** Farbverlauf des Logos von oben nach unten. */
  logo: { from: Rgb; to: Rgb };
  /** Farben der Matrix-Animation. */
  matrix: { cover: [string, string, string]; trail: Rgb; head: string };
}

export const THEME: Theme = {
  font: {
    family: 'ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", Menlo, monospace',
    face: 'JetBrains Mono',
    size: { narrow: 13, wide: 15 },
    lineHeight: 1.25,
  },
  term: {
    background: 'rgba(0, 0, 0, 0)',
    foreground: '#f5f5f7',
    cursor: '#f5f5f7',
    cursorAccent: '#1c1c1e',
    selectionBackground: 'rgba(255, 255, 255, 0.22)',
    black: '#1c1c1e',
    red: '#ff453a',
    green: '#30d158',
    yellow: '#ffd60a',
    blue: '#0a84ff',
    magenta: '#bf5af2',
    cyan: '#64d2ff',
    white: '#f5f5f7',
    brightBlack: '#98989f',
    brightRed: '#ff6961',
    brightGreen: '#5be37d',
    brightYellow: '#ffe14d',
    brightBlue: '#409cff',
    brightMagenta: '#da8fff',
    brightCyan: '#8ee0ff',
    brightWhite: '#ffffff',
  },
  logo: { from: [100, 210, 255], to: [191, 90, 242] },
  matrix: { cover: ['#10131c', '#1f2a44', '#64d2ff'], trail: [100, 210, 255], head: '#ffffff' },
};
