/**
 * Zentrale Command-Registry (Metadaten). Einzige Quelle für `help`.
 * Die Handler liegen pro App (Client bzw. Server), der Name ist der Schlüssel.
 */

export type CommandSide = 'client' | 'server';

export interface CommandSpec {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly usage: string;
  readonly example: string;
  /** Wo der Handler läuft. Custom Commands sind immer clientseitig. */
  readonly side: CommandSide;
}

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'help',
    aliases: [],
    description: 'Zeigt alle Commands mit Benutzung und Beispiel.',
    usage: 'help',
    example: 'help',
    side: 'client',
  },
  {
    name: 'clear',
    aliases: ['cls'],
    description: 'Leert das Terminal (auch Ctrl+L).',
    usage: 'clear',
    example: 'clear',
    side: 'client',
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
