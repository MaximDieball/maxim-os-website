import { findCommand } from '@maxim-os/shared';
import type { LineAction, Output } from './shell.ts';
import { stripAnsi, style } from './text.ts';

/**
 * Klickbare Command-Vorschläge im Text (#93): Alles in einfachen Anführungszeichen,
 * das mit einem registrierten Command beginnt (z. B. 'help --short', 'steckbrief'),
 * wird klickbar und führt genau diesen Text aus. Platzhalter wie 'project <name>'
 * bleiben Text. Geschützte Leerzeichen (gegen Umbruch im Vorschlag) zählen als Leerzeichen.
 */
export function suggestionsIn(line: string): LineAction[] {
  const text = [...stripAnsi(line)];
  const plain = text.join('');
  const out: LineAction[] = [];
  for (const m of plain.matchAll(/'([^'\n]{1,60})'/g)) {
    const command = m[1]!.replace(/\u00a0/g, ' ').trim();
    if (!command || /[<>[\]|]/.test(command)) continue;
    if (!findCommand(command.split(' ')[0]!)) continue;
    // Spalten in Zeichen (Code Points), wie das Terminal sie zählt
    const from = [...plain.slice(0, m.index)].length;
    out.push({ command, from, to: from + [...m[0]].length });
  }
  return out;
}

/**
 * Hebt klickbare Vorschläge sichtbar hervor (gelb, unterstrichen). Die Anführungszeichen
 * bleiben stehen, damit die Spalten aus `suggestionsIn` gleich bleiben.
 */
export function highlightSuggestions(line: string): string {
  // In gedimmtem Text danach wieder dimmen
  const dimmed = line.startsWith('\x1b[2m');
  return line.replace(/'([^'\n]{1,60})'/g, (whole, inner: string) => {
    if (inner.includes('\u001b')) return whole; // schon formatiert
    const command = inner.replace(/\u00a0/g, ' ').trim();
    if (!command || /[<>[\]|]/.test(command)) return whole;
    if (!findCommand(command.split(' ')[0]!)) return whole;
    return `'${style.command(inner, dimmed)}'`;
  });
}

/** Wie `suggestionsIn`, für mehrere Zeilen, und hebt die Vorschläge hervor. */
export function withSuggestions(input: string[]): Output {
  const lines = input.map(highlightSuggestions);
  return {
    lines,
    actions: lines.map((l) => {
      const found = suggestionsIn(l);
      return found.length ? found : undefined;
    }),
  };
}

/** Nicht umbrechen: Leerzeichen in einem Vorschlag schützen ('help --short'). */
export const keepTogether = (command: string): string => command.replace(/ /g, ' ');
