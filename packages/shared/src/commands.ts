/**
 * Zentrale Command-Registry (Metadaten). Einzige Quelle für `help` und für die
 * Allowlist von Flags und Argumenten. Alle Handler laufen im Browser (apps/web),
 * der Name ist der Schlüssel.
 */

/** Erlaubtes Kurz-Flag. Ohne `int` ist es ein Schalter, mit `int` erwartet es eine Zahl. */
export interface FlagSpec {
  readonly short: string;
  /** Optionale Langform, z. B. `short` für `--short` (#93). */
  readonly long?: string;
  readonly description: string;
  readonly int?: { readonly min: number; readonly max: number };
}

/**
 * Gruppen in der Reihenfolge, die für Besucher am wichtigsten ist (#82): zuerst über mich,
 * dann Links zu Repos und gehosteten Projekten, dann Projekte im Terminal, dann der Rest.
 * Die Registry ist danach sortiert; help zeigt die Gruppen mit Überschrift.
 */
export const COMMAND_GROUPS = [
  { id: 'me', title: 'Über mich' },
  { id: 'links', title: 'Projekte und Links' },
  { id: 'play', title: 'Im Terminal ausprobieren' },
  { id: 'files', title: 'Dateien' },
  { id: 'system', title: 'System' },
] as const;

export type CommandGroup = (typeof COMMAND_GROUPS)[number]['id'];

export interface CommandSpec {
  readonly name: string;
  /** Gruppe für die Sortierung in help (siehe COMMAND_GROUPS). */
  readonly group: CommandGroup;
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
    name: 'steckbrief',
    group: 'me',
    aliases: [],
    description: 'Zeigt einen Steckbrief von mir: Bild, Infos und alle Projekte.',
    usage: 'steckbrief',
    example: 'steckbrief',
    flags: [],
    operands: NONE,
    redirect: true,
  },
  {
    name: 'about',
    group: 'me',
    aliases: [],
    description: 'Worum es bei MAXIM OS geht.',
    usage: 'about',
    example: 'about',
    flags: [],
    operands: NONE,
    redirect: true,
  },
  {
    name: 'whoami',
    group: 'me',
    aliases: [],
    description: 'Zeigt, wer du hier bist.',
    usage: 'whoami',
    example: 'whoami',
    flags: [],
    operands: NONE,
    redirect: true,
  },
  {
    name: 'projects',
    group: 'links',
    aliases: [],
    description: 'Listet meine Projekte. Ein Klick öffnet die Projektseite.',
    usage: 'projects',
    example: 'projects',
    flags: [],
    operands: NONE,
    redirect: true,
  },
  {
    name: 'project',
    group: 'links',
    aliases: [],
    description: 'Projektseite: Infos, Links zu GitHub und Website und die README.',
    usage: 'project <name>',
    example: 'project maxim-os-website',
    flags: [],
    operands: { min: 1, max: 1, label: 'Projekt' },
    redirect: true,
  },
  {
    name: 'watchthis',
    group: 'links',
    aliases: ['wt', 'WatchThis'],
    description: 'Öffnet meine Film-Seite movies.maxim-dieball.de in einem neuen Tab.',
    usage: 'watchthis',
    example: 'watchthis',
    flags: [],
    operands: NONE,
  },
  {
    name: 'minecraft',
    group: 'links',
    aliases: ['mc'],
    description: 'Status meines Minecraft-Servers: online, Spieler, Version und Ping.',
    usage: 'minecraft',
    example: 'minecraft',
    flags: [],
    operands: NONE,
    redirect: true,
  },
  {
    name: 'snake',
    group: 'play',
    aliases: [],
    description: 'Snake im Terminal. Pfeile/WASD lenken, Esc oder Ctrl+C beendet.',
    usage: 'snake',
    example: 'snake',
    flags: [],
    operands: NONE,
  },
  {
    name: 'ls',
    group: 'files',
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
    group: 'files',
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
    group: 'files',
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
    group: 'files',
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
    group: 'files',
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
    group: 'files',
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
    group: 'files',
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
    group: 'files',
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
    group: 'files',
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
    group: 'files',
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
    group: 'files',
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
    group: 'files',
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
    group: 'files',
    aliases: [],
    description: 'Verwirft alle deine Änderungen und stellt das Original wieder her.',
    usage: 'reset',
    example: 'reset',
    flags: [],
    operands: NONE,
    writes: true,
  },
  {
    name: 'help',
    group: 'system',
    aliases: [],
    description: 'Zeigt alle Commands. --short: Kurzfassung, help <command>: Details.',
    usage: 'help [-s|--short] [command]',
    example: 'help --short',
    flags: [{ short: 's', long: 'short', description: 'Kurzfassung, passt auf einen Bildschirm' }],
    operands: { min: 0, max: 1, label: 'Command' },
    redirect: true,
  },
  {
    name: 'clear',
    group: 'system',
    aliases: ['cls'],
    description: 'Leert das Terminal (auch Ctrl+L).',
    usage: 'clear',
    example: 'clear',
    flags: [],
    operands: NONE,
  },
  {
    name: 'history',
    group: 'system',
    aliases: [],
    description: 'Zeigt deine letzten Eingaben.',
    usage: 'history',
    example: 'history',
    flags: [],
    operands: NONE,
    redirect: true,
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
