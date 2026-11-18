import { COMMANDS, findCommand } from '@maxim-os/shared';
import { CLIENT_HANDLERS } from './commands.ts';
import { History } from './history.ts';
import { sanitizeInput, style, truncate } from './text.ts';

/** Ausgabekanal, den das Terminal (xterm.js) bereitstellt. */
export interface ShellOutput {
  /** Gibt Zeilen aus. ANSI-Farben sind erlaubt. */
  print(lines: string[]): void;
  clear(): void;
  /** Aktuelle Breite in Zeichen. */
  cols(): number;
}

export interface CommandContext {
  out: ShellOutput;
  args: string[];
  shell: Shell;
}

export type ClientHandler = (ctx: CommandContext) => void;

const MAX_NAME_IN_ERROR = 40;

export class Shell {
  readonly history = new History();

  private readonly out: ShellOutput;

  constructor(out: ShellOutput) {
    this.out = out;
  }

  execute(rawLine: string): void {
    const line = sanitizeInput(rawLine).trim();
    this.history.push(line);
    if (!line) return;

    const [name = '', ...args] = line.split(/\s+/);
    const spec = findCommand(name);
    const handler =
      spec && Object.hasOwn(CLIENT_HANDLERS, spec.name) ? CLIENT_HANDLERS[spec.name] : undefined;
    if (!spec || !handler) {
      this.out.print([
        `${style.red('command not found:')} ${truncate(name, MAX_NAME_IN_ERROR)}. Tippe 'help'.`,
      ]);
      return;
    }
    handler({ out: this.out, args, shell: this });
  }

  /**
   * Tab-Completion für Command-Namen. Gibt die neue Eingabe zurück;
   * bei mehreren Treffern werden die Kandidaten ausgegeben.
   */
  complete(input: string): string {
    if (/\s/.test(input)) return input;
    const candidates = COMMANDS.flatMap((c) => [c.name, ...c.aliases])
      .filter((n) => n.startsWith(input))
      .sort();
    if (candidates.length === 0) return input;
    if (candidates.length === 1) return `${candidates[0]} `;
    this.out.print([candidates.join('  ')]);
    return commonPrefix(candidates);
  }
}

function commonPrefix(words: string[]): string {
  let prefix = words[0] ?? '';
  for (const w of words) while (!w.startsWith(prefix)) prefix = prefix.slice(0, -1);
  return prefix;
}
