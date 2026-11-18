/**
 * Zentrale Command-Registry (Metadaten). Einzige Quelle für `help` und für die
 * Allowlist von Flags und Argumenten. Die Handler liegen pro App (Client bzw.
 * Server), der Name ist der Schlüssel.
 */

export type CommandSide = 'client' | 'server';

/** Erlaubtes Kurz-Flag. Ohne `int` ist es ein Schalter, mit `int` erwartet es eine Zahl. */
export interface FlagSpec {
  readonly short: string;
  readonly description: string;
  readonly int?: { readonly min: number; readonly max: number };
}

export interface CommandSpec {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly usage: string;
  readonly example: string;
  /** Wo der Handler läuft. Custom Commands sind immer clientseitig. */
  readonly side: CommandSide;
  /** Allowlist der Flags. Alles andere wird abgelehnt. */
  readonly flags: readonly FlagSpec[];
  /** Erlaubte Anzahl an Argumenten (ohne Flags). */
  readonly operands: { readonly min: number; readonly max: number; readonly label: string };
  /** Argumente sind Pfade (für die Tab-Completion). */
  readonly pathOperands?: boolean;
}

const NONE = { min: 0, max: 0, label: '' } as const;

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'help',
    aliases: [],
    description: 'Zeigt alle Commands mit Benutzung und Beispiel.',
    usage: 'help',
    example: 'help',
    side: 'client',
    flags: [],
    operands: NONE,
  },
  {
    name: 'clear',
    aliases: ['cls'],
    description: 'Leert das Terminal (auch Ctrl+L).',
    usage: 'clear',
    example: 'clear',
    side: 'client',
    flags: [],
    operands: NONE,
  },
  {
    name: 'ls',
    aliases: [],
    description: 'Listet den Inhalt eines Ordners. -l ausführlich, -a mit versteckten Dateien.',
    usage: 'ls [-l] [-a] [ordner]',
    example: 'ls -la projects',
    side: 'server',
    flags: [
      { short: 'l', description: 'ausführliche Liste' },
      { short: 'a', description: 'auch versteckte Einträge' },
    ],
    operands: { min: 0, max: 1, label: 'Ordner' },
    pathOperands: true,
  },
  {
    name: 'cd',
    aliases: [],
    description: 'Wechselt den Ordner. Ohne Angabe zurück nach /.',
    usage: 'cd [ordner]',
    example: 'cd projects',
    side: 'server',
    flags: [],
    operands: { min: 0, max: 1, label: 'Ordner' },
    pathOperands: true,
  },
  {
    name: 'pwd',
    aliases: [],
    description: 'Zeigt den aktuellen Ordner.',
    usage: 'pwd',
    example: 'pwd',
    side: 'server',
    flags: [],
    operands: NONE,
  },
  {
    name: 'cat',
    aliases: [],
    description: 'Zeigt eine Textdatei an.',
    usage: 'cat <datei>',
    example: 'cat README.txt',
    side: 'server',
    flags: [],
    operands: { min: 1, max: 1, label: 'Datei' },
    pathOperands: true,
  },
  {
    name: 'tree',
    aliases: [],
    description: 'Zeigt Ordner als Baum. -L begrenzt die Tiefe (1–5).',
    usage: 'tree [-L tiefe] [ordner]',
    example: 'tree -L 2',
    side: 'server',
    flags: [{ short: 'L', description: 'maximale Tiefe', int: { min: 1, max: 5 } }],
    operands: { min: 0, max: 1, label: 'Ordner' },
    pathOperands: true,
  },
];

const lookup = new Map<string, CommandSpec>();
for (const spec of COMMANDS) {
  for (const key of [spec.name, ...spec.aliases]) lookup.set(key, spec);
}

/** Sucht einen Command per Name oder Alias (case-sensitive). */
export function findCommand(input: string): CommandSpec | undefined {
  return lookup.get(input);
}
