import { COMMAND_GROUPS, type CommandSpec } from '@maxim-os/shared';
import type { LineAction, Output } from './shell.ts';
import { highlightSuggestions, keepTogether, suggestionsIn } from './suggest.ts';
import { style, truncate, wrap } from './text.ts';

const HEADERS = ['COMMAND', 'BESCHREIBUNG', 'USAGE', 'BEISPIEL'] as const;
const GAP = '  ';
const INDENT = '  ';

/** Gruppen, die in `help --short` nur als Namen in einer Zeile stehen (für Besucher unwichtiger). */
const COMPACT_GROUPS = new Set(['files', 'system']);

function names(spec: CommandSpec): string {
  return [spec.name, ...spec.aliases].join(', ');
}

/** Specs nach Gruppen in der Reihenfolge von COMMAND_GROUPS; leere Gruppen fehlen. */
function grouped(
  specs: readonly CommandSpec[],
): { id: string; title: string; specs: CommandSpec[] }[] {
  return COMMAND_GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    specs: specs.filter((s) => s.group === g.id),
  })).filter((g) => g.specs.length > 0);
}

const heading = (title: string): string => style.bold(style.yellow(title));
/** Klickbarer Command-Name (öffnet `help <name>`): cyan und unterstrichen. */
const clickName = (name: string): string => style.cyan(style.underline(name));
const details = (spec: CommandSpec): LineAction => ({ command: `help ${spec.name}` });

/** Sammelt Zeilen und ihre klickbaren Bereiche. */
class Builder {
  readonly lines: string[] = [];
  readonly actions: Output['actions'] = [];
  push(line: string, action?: LineAction | readonly LineAction[]): void {
    this.actions[this.lines.length] = action;
    this.lines.push(line);
  }
  /** Zeile, deren Vorschläge in Anführungszeichen klickbar sind. */
  text(line: string): void {
    const found = suggestionsIn(line);
    this.push(highlightSuggestions(line), found.length ? found : undefined);
  }
  output(): Output {
    return { lines: this.lines, actions: this.actions };
  }
}

/** Mindestbreite der Beschreibungsspalte, sonst lieber gestapelt. */
const MIN_DESC = 30;

/**
 * Tabelle für breite Terminals. Die Beschreibung bricht innerhalb ihrer Spalte um,
 * wenn sie nicht in eine Zeile passt. Gibt `false` zurück, wenn es zu eng wird.
 */
function table(b: Builder, specs: readonly CommandSpec[], cols: number): boolean {
  const cells = (s: CommandSpec) => [names(s), s.description, s.usage, s.example];
  const widths = HEADERS.map((h, i) =>
    Math.max(h.length, ...specs.map((s) => cells(s)[i]!.length)),
  );
  const fixed =
    INDENT.length + widths[0]! + widths[2]! + widths[3]! + GAP.length * (widths.length - 1);
  const desc = Math.min(widths[1]!, cols - fixed);
  if (desc < MIN_DESC) return false;
  widths[1] = desc;
  const line = (row: readonly string[], first = (c: string) => c) =>
    (
      INDENT +
      row
        .map((c, i) =>
          i === 0 ? first(c) + ' '.repeat(widths[i]! - c.length) : c.padEnd(widths[i]!),
        )
        .join(GAP)
    ).trimEnd();

  b.push(style.dim(line(HEADERS)));
  for (const group of grouped(specs)) {
    b.push('');
    b.push(heading(group.title));
    for (const s of group.specs) {
      const [name, description, usage, example] = cells(s);
      const parts = wrap(description!, desc);
      b.push(line([name!, parts[0] ?? '', usage!, example!], clickName), details(s));
      for (const more of parts.slice(1)) b.push(line(['', more, '', '']), details(s));
    }
  }
  return true;
}

/** Gestapelte Variante für schmale Bildschirme. */
function stacked(b: Builder, specs: readonly CommandSpec[], cols: number): void {
  const width = Math.max(10, cols - INDENT.length);
  let first = true;
  for (const group of grouped(specs)) {
    if (!first) b.push('');
    first = false;
    b.push(heading(group.title));
    b.push('');
    group.specs.forEach((s, i) => {
      if (i > 0) b.push('');
      b.push(style.bold(clickName(names(s))), details(s));
      for (const l of wrap(s.description, width)) b.push(INDENT + l, details(s));
      for (const l of wrap(`Usage:    ${s.usage}`, width)) b.push(INDENT + style.dim(l));
      for (const l of wrap(`Beispiel: ${s.example}`, width)) b.push(INDENT + style.dim(l));
    });
  }
}

/** Kurze Erklärung von `help` selbst, mit klickbaren Vorschlägen. */
function explain(b: Builder, cols: number, short: boolean): void {
  const width = Math.max(20, cols - 1);
  const text = short
    ? `Kurzfassung. Klick auf einen Command oder '${keepTogether('help <command>')}' zeigt Details, '${keepTogether('help')}' alle Commands mit Beispielen.`
    : `Klick auf einen Command oder '${keepTogether('help <command>')}' zeigt Details. Kurzfassung: '${keepTogether('help --short')}'.`;
  for (const l of wrap(text, width)) b.text(style.dim(l));
}

/** `help`: alle Commands, ausschließlich aus der Registry. */
export function formatHelp(specs: readonly CommandSpec[], cols: number): Output {
  const b = new Builder();
  b.push(style.bold('Verfügbare Commands:'));
  explain(b, cols, false);
  b.push('');
  if (!table(b, specs, cols)) stacked(b, specs, cols);
  return b.output();
}

/**
 * `help --short`: wichtige Gruppen mit Name und einzeiliger Beschreibung, der Rest nur
 * als Namen nebeneinander. Passt auf einen Desktop-Bildschirm (#93).
 */
export function formatHelpShort(specs: readonly CommandSpec[], cols: number): Output {
  const b = new Builder();
  const width = Math.max(20, cols - 1);
  explain(b, cols, true);
  const groups = grouped(specs);
  const nameWidth = Math.max(
    ...groups
      .filter((g) => !COMPACT_GROUPS.has(g.id))
      .flatMap((g) => g.specs.map((s) => s.name.length)),
  );
  for (const group of groups) {
    b.push('');
    b.push(heading(group.title));
    if (!COMPACT_GROUPS.has(group.id)) {
      for (const s of group.specs) {
        const room = width - INDENT.length - nameWidth - GAP.length;
        const desc = room >= 12 ? `${GAP}${style.dim(truncate(s.description, room))}` : '';
        b.push(
          `${INDENT}${clickName(s.name)}${' '.repeat(nameWidth - s.name.length)}${desc}`.trimEnd(),
          details(s),
        );
      }
      continue;
    }
    // Namen nebeneinander, jeder einzeln klickbar
    let line = INDENT;
    let plain = INDENT.length;
    let actions: LineAction[] = [];
    for (const s of group.specs) {
      const sep = plain > INDENT.length ? GAP.length : 0;
      if (plain + sep + s.name.length > width && plain > INDENT.length) {
        b.push(line, actions);
        line = INDENT;
        plain = INDENT.length;
        actions = [];
      }
      if (plain > INDENT.length) {
        line += GAP;
        plain += GAP.length;
      }
      actions.push({ ...details(s), from: plain, to: plain + s.name.length });
      line += clickName(s.name);
      plain += s.name.length;
    }
    if (plain > INDENT.length) b.push(line, actions);
  }
  return b.output();
}

const LABEL = 10;

/** `help <command>`: alles zu einem Command. */
export function formatCommandHelp(spec: CommandSpec, cols: number): Output {
  const b = new Builder();
  const width = Math.max(20, cols - 1);
  const field = (label: string, value: string, action?: LineAction): void => {
    wrap(value, Math.max(10, width - LABEL)).forEach((l, i) =>
      b.push(
        `${i === 0 ? style.dim(label.padEnd(LABEL)) : ' '.repeat(LABEL)}${action ? style.command(l) : l}`,
        action && { ...action, from: LABEL },
      ),
    );
  };
  b.push(style.bold(style.cyan(spec.name)));
  for (const l of wrap(spec.description, width)) b.push(l);
  b.push('');
  field('Usage', spec.usage);
  // Beispiele nur klickbar, wenn sie nichts verändern
  const safe = !spec.writes && !spec.example.includes('>') && spec.name !== 'reset';
  field('Beispiel', spec.example, safe ? { command: spec.example } : undefined);
  if (spec.aliases.length) field('Aliase', spec.aliases.join(', '));
  const flagName = (f: CommandSpec['flags'][number]) =>
    f.long ? `-${f.short}, --${f.long}` : `-${f.short}`;
  const flagWidth = Math.max(0, ...spec.flags.map((f) => flagName(f).length));
  spec.flags.forEach((f, i) => {
    const room = Math.max(10, width - LABEL - flagWidth - GAP.length);
    wrap(f.description, room).forEach((l, k) => {
      const label = style.dim((i === 0 && k === 0 ? 'Flags' : '').padEnd(LABEL));
      const name = (k === 0 ? flagName(f) : '').padEnd(flagWidth);
      b.push(`${label}${name}${GAP}${l}`);
    });
  });
  const group = COMMAND_GROUPS.find((g) => g.id === spec.group);
  if (group) field('Gruppe', group.title);
  b.push('');
  b.text(style.dim(`Alle Commands: '${keepTogether('help --short')}'`));
  return b.output();
}
