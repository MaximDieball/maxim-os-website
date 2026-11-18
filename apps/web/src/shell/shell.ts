import { COMMANDS, findCommand, parseArgs, tokenize, type CommandResult } from '@maxim-os/shared';
import { ApiError, type ServerApi } from './api.ts';
import { CLIENT_HANDLERS } from './commands.ts';
import { clean, formatCat, formatLs, formatTree } from './format.ts';
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

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

export class Shell {
  readonly history = new History();
  /** Aktuelles simuliertes Verzeichnis. Der Server prüft es bei jedem Request neu. */
  cwd = '/';

  private readonly out: ShellOutput;
  private readonly api: ServerApi | undefined;

  constructor(out: ShellOutput, api?: ServerApi) {
    this.out = out;
    this.api = api;
  }

  private error(message: string): void {
    // Meldungen können Teile der Eingabe bzw. Serverantwort enthalten: nie ungefiltert ausgeben.
    this.out.print([style.red(clean(message))]);
  }

  /** Führt eine Eingabezeile aus. `signal` bricht laufende Server-Anfragen ab (Ctrl+C). */
  async execute(rawLine: string, signal?: AbortSignal): Promise<void> {
    const line = sanitizeInput(rawLine).trim();
    this.history.push(line);
    if (!line) return;

    const tokens = tokenize(line);
    if (!tokens.ok) return this.error(tokens.error);
    const [name = '', ...args] = tokens.tokens;

    const spec = findCommand(name);
    if (!spec) {
      this.out.print([
        `${style.red('command not found:')} ${truncate(name, MAX_NAME_IN_ERROR)}. Tippe 'help'.`,
      ]);
      return;
    }
    // Allowlist schon im Client prüfen; der Server prüft trotzdem selbst.
    const argv = parseArgs(spec, args);
    if (!argv.ok) return this.error(argv.error);

    if (spec.side === 'client') {
      const handler = Object.hasOwn(CLIENT_HANDLERS, spec.name)
        ? CLIENT_HANDLERS[spec.name]
        : undefined;
      if (!handler) return this.error(`${spec.name}: nicht verfügbar`);
      return handler({ out: this.out, args, shell: this });
    }

    if (!this.api) return this.error(`${spec.name}: nicht verfügbar`);
    try {
      const result = await this.api.command({ cwd: this.cwd, name: spec.name, args }, signal);
      this.render(result);
    } catch (error) {
      if (isAbort(error) || signal?.aborted) return;
      this.error(`${spec.name}: ${error instanceof ApiError ? error.message : 'Fehler.'}`);
    }
  }

  private render(result: CommandResult): void {
    const cols = this.out.cols();
    switch (result.kind) {
      case 'ls':
        return this.out.print(formatLs(result.entries, result.long, cols));
      case 'cd':
        this.cwd = result.cwd;
        return;
      case 'pwd':
        return this.out.print([result.cwd]);
      case 'cat':
        return this.out.print(formatCat(result.text));
      case 'tree':
        return this.out.print(
          formatTree(result.root, result.dirs, result.files, result.truncated, cols),
        );
      case 'error':
        if (result.resetCwd) this.cwd = '/';
        return this.error(result.message);
    }
  }

  /**
   * Tab-Completion: erstes Wort aus der Registry, Pfad-Argumente über den Server.
   * Gibt die neue Eingabe zurück; bei mehreren Treffern werden die Kandidaten ausgegeben.
   */
  async complete(input: string, signal?: AbortSignal): Promise<string> {
    if (!/\s/.test(input)) {
      const names = COMMANDS.flatMap((c) => [c.name, ...c.aliases])
        .filter((n) => n.startsWith(input))
        .sort();
      return this.pick(input, '', names, (n) => n, ' ');
    }

    const spec = findCommand(input.trimStart().split(/\s+/)[0] ?? '');
    if (!spec?.pathOperands || !this.api) return input;
    const partial = /\s$/.test(input) ? '' : (input.split(/\s+/).at(-1) ?? '');
    if (/["']/.test(partial) || partial.startsWith('-')) return input;
    let candidates: string[];
    try {
      candidates = await this.api.complete({ cwd: this.cwd, partial }, signal);
    } catch {
      return input;
    }
    const head = input.slice(0, input.length - partial.length);
    const basename = (c: string) =>
      c.replace(/\/$/, '').split('/').at(-1)! + (c.endsWith('/') ? '/' : '');
    return this.pick(input, head, candidates, basename, (c) => (c.endsWith('/') ? '' : ' '));
  }

  private pick(
    input: string,
    head: string,
    candidates: string[],
    label: (c: string) => string,
    suffix: string | ((c: string) => string),
  ): string {
    if (candidates.length === 0) return input;
    if (candidates.length === 1) {
      const only = candidates[0]!;
      return head + only + (typeof suffix === 'string' ? suffix : suffix(only));
    }
    this.out.print([candidates.map(label).join('  ')]);
    const prefix = commonPrefix(candidates);
    return prefix.length > input.length - head.length ? head + prefix : input;
  }
}

function commonPrefix(words: string[]): string {
  let prefix = words[0] ?? '';
  for (const w of words) while (!w.startsWith(prefix)) prefix = prefix.slice(0, -1);
  return prefix;
}
