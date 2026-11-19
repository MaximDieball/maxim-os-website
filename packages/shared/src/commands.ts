/**
 * Zentrale Command-Registry (Metadaten). Einzige Quelle für `help` und für die
 * Allowlist von Flags und Argumenten. Alle Handler laufen im Browser (apps/web),
 * der Name ist der Schlüssel.
 */

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
  /** Allowlist der Flags. Alles andere wird abgelehnt. */
  readonly flags: readonly FlagSpec[];
  /** Erlaubte Anzahl an Argumenten (ohne Flags). */
  readonly operands: { readonly min: number; readonly max: number; readonly label: string };
  /** Argumente sind Pfade (für die Tab-Completion). */
  readonly pathOperands?: boolean;
  /** Argumente werden nicht als Flags gelesen (z. B. echo). */
  readonly rawArgs?: boolean;
  /** Ausgabe darf mit `>`/`>>` in eine Datei umgeleitet werden. */
  readonly redirect?: boolean;
  /** Verändert das Dateisystem (danach wird gespeichert). */
  readonly writes?: boolean;
}

const NONE = { min: 0, max: 0, label: '' } as const;
/** Höchstzahl Pfade bei Commands mit mehreren Argumenten (mkdir a b c). */
const MANY = 8;

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'help',
    aliases: [],
    description: 'Zeigt alle Commands mit Benutzung und Beispiel.',
    usage: 'help',
    example: 'help',
    flags: [],
    operands: NONE,
    redirect: true,
  },
  {
    name: 'clear',
    aliases: ['cls'],
    description: 'Leert das Terminal (auch Ctrl+L).',
    usage: 'clear',
    example: 'clear',
    flags: [],
    operands: NONE,
  },
  {
    name: 'ls',
    aliases: [],
    description: 'Listet den Inhalt eines Ordners. -l ausführlich, -a mit versteckten Dateien.',
    usage: 'ls [-l] [-a] [ordner]',
    example: 'ls -la projects',
    flags: [
      { short: 'l', description: 'ausführliche Liste' },
      { short: 'a', description: 'auch versteckte Einträge' },
    ],
    operands: { min: 0, max: 1, label: 'Ordner' },
    pathOperands: true,
    redirect: true,
  },
  {
    name: 'cd',
    aliases: [],
    description: 'Wechselt den Ordner. Ohne Angabe zurück nach /.',
    usage: 'cd [ordner]',
    example: 'cd projects',
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
    flags: [],
    operands: NONE,
    redirect: true,
  },
  {
    name: 'cat',
    aliases: [],
    description: 'Zeigt eine Textdatei an.',
    usage: 'cat <datei>',
    example: 'cat README.txt',
    flags: [],
    operands: { min: 1, max: 1, label: 'Datei' },
    pathOperands: true,
    redirect: true,
  },
  {
    name: 'tree',
    aliases: [],
    description: 'Zeigt Ordner als Baum. -L begrenzt die Tiefe (1–5).',
    usage: 'tree [-L tiefe] [ordner]',
    example: 'tree -L 2',
    flags: [{ short: 'L', description: 'maximale Tiefe', int: { min: 1, max: 5 } }],
    operands: { min: 0, max: 1, label: 'Ordner' },
    pathOperands: true,
    redirect: true,
  },
  {
    name: 'mkdir',
    aliases: [],
    description: 'Legt Ordner an. -p legt auch fehlende Zwischenordner an.',
    usage: 'mkdir [-p] <ordner>...',
    example: 'mkdir -p notizen/2026',
    flags: [{ short: 'p', description: 'Zwischenordner anlegen, kein Fehler wenn vorhanden' }],
    operands: { min: 1, max: MANY, label: 'Ordner' },
    pathOperands: true,
    writes: true,
  },
  {
    name: 'touch',
    aliases: [],
    description: 'Legt leere Dateien an oder aktualisiert ihren Zeitstempel.',
    usage: 'touch <datei>...',
    example: 'touch notiz.txt',
    flags: [],
    operands: { min: 1, max: MANY, label: 'Datei' },
    pathOperands: true,
    writes: true,
  },
  {
    name: 'rm',
    aliases: [],
    description: 'Löscht Dateien. -r auch Ordner mit Inhalt, -f ohne Fehler bei fehlenden.',
    usage: 'rm [-r] [-f] <pfad>...',
    example: 'rm -r alter-ordner',
    flags: [
      { short: 'r', description: 'Ordner mit Inhalt löschen' },
      { short: 'f', description: 'fehlende Pfade ignorieren' },
    ],
    operands: { min: 1, max: MANY, label: 'Pfad' },
    pathOperands: true,
    writes: true,
  },
  {
    name: 'rmdir',
    aliases: [],
    description: 'Löscht leere Ordner.',
    usage: 'rmdir <ordner>...',
    example: 'rmdir leer',
    flags: [],
    operands: { min: 1, max: MANY, label: 'Ordner' },
    pathOperands: true,
    writes: true,
  },
  {
    name: 'mv',
    aliases: [],
    description: 'Verschiebt oder benennt um.',
    usage: 'mv <quelle> <ziel>',
    example: 'mv notiz.txt notizen/',
    flags: [],
    operands: { min: 2, max: 2, label: 'Quelle und Ziel' },
    pathOperands: true,
    writes: true,
  },
  {
    name: 'cp',
    aliases: [],
    description: 'Kopiert Dateien. -r kopiert Ordner mit Inhalt.',
    usage: 'cp [-r] <quelle> <ziel>',
    example: 'cp -r projects backup',
    flags: [{ short: 'r', description: 'Ordner mit Inhalt kopieren' }],
    operands: { min: 2, max: 2, label: 'Quelle und Ziel' },
    pathOperands: true,
    writes: true,
  },
  {
    name: 'echo',
    aliases: [],
    description: 'Gibt Text aus, mit > oder >> auch in eine Datei.',
    usage: 'echo <text> [> datei]',
    example: 'echo hallo > gruss.txt',
    flags: [],
    operands: { min: 0, max: 15, label: 'Text' },
    rawArgs: true,
    redirect: true,
  },
  {
    name: 'reset',
    aliases: [],
    description: 'Verwirft alle deine Änderungen und stellt das Original wieder her.',
    usage: 'reset',
    example: 'reset',
    flags: [],
    operands: NONE,
    writes: true,
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
