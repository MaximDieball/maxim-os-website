import { COMMAND_GROUPS, type CommandSpec } from '@maxim-os/shared';
import { style, wrap } from './text.ts';

const HEADERS = ['COMMAND', 'BESCHREIBUNG', 'USAGE', 'BEISPIEL'] as const;
const GAP = '  ';
const INDENT = '  ';

function names(spec: CommandSpec): string {
  return [spec.name, ...spec.aliases].join(', ');
}

/** Specs nach Gruppen in der Reihenfolge von COMMAND_GROUPS; leere Gruppen fehlen. */
function grouped(specs: readonly CommandSpec[]): { title: string; specs: CommandSpec[] }[] {
  return COMMAND_GROUPS.map((g) => ({
    title: g.title,
    specs: specs.filter((s) => s.group === g.id),
  })).filter((g) => g.specs.length > 0);
}

const heading = (title: string): string => style.bold(style.yellow(title));

/** Mindestbreite der Beschreibungsspalte, sonst lieber gestapelt. */
const MIN_DESC = 30;

/**
 * Tabelle für breite Terminals. Die Beschreibung bricht innerhalb ihrer Spalte um,
 * wenn sie nicht in eine Zeile passt. Gibt `undefined` zurück, wenn es zu eng wird.
 */
function table(specs: readonly CommandSpec[], cols: number): string[] | undefined {
  const cells = (s: CommandSpec) => [names(s), s.description, s.usage, s.example];
  const widths = HEADERS.map((h, i) =>
    Math.max(h.length, ...specs.map((s) => cells(s)[i]!.length)),
  );
  const fixed =
    INDENT.length + widths[0]! + widths[2]! + widths[3]! + GAP.length * (widths.length - 1);
  const desc = Math.min(widths[1]!, cols - fixed);
  if (desc < MIN_DESC) return undefined;
  widths[1] = desc;
  const line = (row: readonly string[], first = (c: string) => c) =>
    (
      INDENT +
      row.map((c, i) => (i === 0 ? first(c.padEnd(widths[i]!)) : c.padEnd(widths[i]!))).join(GAP)
    ).trimEnd();

  const out = [style.dim(line(HEADERS))];
  for (const group of grouped(specs)) {
    out.push('', heading(group.title));
    for (const s of group.specs) {
      const [name, description, usage, example] = cells(s);
      const parts = wrap(description!, desc);
      out.push(line([name!, parts[0] ?? '', usage!, example!], style.cyan));
      for (const more of parts.slice(1)) out.push(line(['', more, '', '']));
    }
  }
  return out;
}

/** Gestapelte Variante für schmale Bildschirme. */
function stacked(specs: readonly CommandSpec[], cols: number): string[] {
  const width = Math.max(10, cols - INDENT.length);
  const out: string[] = [];
  for (const group of grouped(specs)) {
    out.push(heading(group.title), '');
    for (const s of group.specs) {
      out.push(style.bold(style.cyan(names(s))));
      for (const l of wrap(s.description, width)) out.push(INDENT + l);
      for (const l of wrap(`Usage:    ${s.usage}`, width)) out.push(INDENT + style.dim(l));
      for (const l of wrap(`Beispiel: ${s.example}`, width)) out.push(INDENT + style.dim(l));
      out.push('');
    }
  }
  out.pop();
  return out;
}

/** Generiert `help` ausschließlich aus der Registry. */
export function formatHelp(specs: readonly CommandSpec[], cols: number): string[] {
  const body = table(specs, cols) ?? stacked(specs, cols);
  return [style.bold('Verfügbare Commands:'), '', ...body];
}
