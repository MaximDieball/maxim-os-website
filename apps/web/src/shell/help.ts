import type { CommandSpec } from '@maxim-os/shared';
import { style, wrap } from './text.ts';

const HEADERS = ['COMMAND', 'BESCHREIBUNG', 'USAGE', 'BEISPIEL'] as const;
const GAP = '  ';
const INDENT = '  ';

function names(spec: CommandSpec): string {
  return [spec.name, ...spec.aliases].join(', ');
}

/** Tabelle für breite Terminals. Gibt `undefined` zurück, wenn sie nicht passt. */
function table(specs: readonly CommandSpec[], cols: number): string[] | undefined {
  const rows = specs.map((s) => [names(s), s.description, s.usage, s.example]);
  const widths = HEADERS.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const total =
    INDENT.length + widths.reduce((a, b) => a + b, 0) + GAP.length * (widths.length - 1);
  if (total > cols) return undefined;
  const line = (cells: readonly string[]) =>
    (INDENT + cells.map((c, i) => c.padEnd(widths[i]!)).join(GAP)).trimEnd();
  return [
    style.bold(line(HEADERS)),
    ...rows.map((r) => {
      const [first, ...rest] = r.map((c, i) => c.padEnd(widths[i]!));
      return (INDENT + style.cyan(first!) + GAP + rest.join(GAP)).trimEnd();
    }),
  ];
}

/** Gestapelte Variante für schmale Bildschirme. */
function stacked(specs: readonly CommandSpec[], cols: number): string[] {
  const width = Math.max(10, cols - INDENT.length);
  const out: string[] = [];
  for (const s of specs) {
    out.push(style.bold(style.cyan(names(s))));
    for (const l of wrap(s.description, width)) out.push(INDENT + l);
    for (const l of wrap(`Usage:    ${s.usage}`, width)) out.push(INDENT + style.dim(l));
    for (const l of wrap(`Beispiel: ${s.example}`, width)) out.push(INDENT + style.dim(l));
    out.push('');
  }
  out.pop();
  return out;
}

/** Generiert `help` ausschließlich aus der Registry. */
export function formatHelp(specs: readonly CommandSpec[], cols: number): string[] {
  const body = table(specs, cols) ?? stacked(specs, cols);
  return [style.bold('Verfügbare Commands:'), '', ...body];
}
