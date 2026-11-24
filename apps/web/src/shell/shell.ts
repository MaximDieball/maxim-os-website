import {
  COMMANDS,
  findCommand,
  parseArgs,
  printable,
  tokenize,
  type CommandSpec,
  type FlagValues,
} from '@maxim-os/shared';
import { VfsError } from '../vfs/vfs.ts';
import type { GithubData } from '../profile/github.ts';
import type { AskMessage, MinecraftStatus } from '@maxim-os/shared';
import type { GameScreen } from '../games/run-snake.ts';
import type { KeyValueStore, Workspace } from '../vfs/workspace.ts';
import { CLIENT_HANDLERS, OPERAND_COMPLETIONS } from './commands.ts';
import { clean } from './format.ts';
import { History } from './history.ts';
import { keepTogether, suggestionsIn } from './suggest.ts';
import { sanitizeInput, stripAnsi, style, truncate } from './text.ts';

/** Ausgabekanal, den das Terminal (xterm.js) bereitstellt. */
/**
 * Klickbare Zeile (#90): Ein Klick bzw. Tippen führt `command` aus, als wäre es
 * getippt worden. `from` ist die erste klickbare Spalte (z. B. neben dem Porträt).
 */
export interface LineAction {
  command: string;
  from?: number;
  /** Erste Spalte hinter dem klickbaren Bereich (ohne: bis zum Zeilenende). */
  to?: number;
}

/** Klickbare Bereiche je Zeile: einer, mehrere (z. B. Vorschläge im Text) oder keiner. */
export type PrintActions = readonly (LineAction | readonly LineAction[] | undefined)[];

/** Zeilen plus klickbare Bereiche (gleiche Indizes), für `ShellOutput.print`. */
export interface Output {
  lines: string[];
  actions: (LineAction | readonly LineAction[] | undefined)[];
}

export interface ShellOutput {
  /**
   * Gibt Zeilen aus. ANSI-Farben sind erlaubt. `actions[i]` macht Zeile i klickbar
   * (nur im Terminal; bei Umleitung in eine Datei entfällt es).
   */
  print(lines: string[], actions?: PrintActions): void;
  /** Ersetzt die zuletzt ausgegebene Zeile, z. B. für Ladebalken (#34). Optional. */
  replaceLast?(line: string): void;
  clear(): void;
  /** Aktuelle Breite in Zeichen. */
  cols(): number;
}

export interface CommandContext {
  /** Normale Ausgabe (bei `>`/`>>` landet sie in der Datei). */
  out: ShellOutput;
  spec: CommandSpec;
  args: string[];
  flags: FlagValues;
  operands: string[];
  shell: Shell;
  /** Arbeitskopie; undefined, wenn der Snapshot nicht geladen werden konnte. */
  ws: Workspace | undefined;
  signal: AbortSignal | undefined;
  services: ShellServices;
}

/** Externe Dienste der Shell (im Test durch Fakes ersetzt). */
export interface ShellServices {
  /** Öffentliche GitHub-Daten; undefined, wenn nicht erreichbar. */
  github?: () => Promise<GithubData | undefined>;
  /** Wartet `ms` Millisekunden; endet sofort bei Abbruch (im Test ersetzbar). */
  delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /**
   * Fragt den KI-Assistenten (#74). `onText` bekommt die Antwort Stück für Stück.
   * Ergebnis: vollständige Antwort oder eine freundliche Fehlermeldung.
   */
  ask?: (
    messages: AskMessage[],
    onText: (text: string) => void,
    signal?: AbortSignal,
  ) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  /** Status des Minecraft-Servers über GET /api/minecraft (#36). */
  minecraft?: (signal?: AbortSignal) => Promise<MinecraftStatus | undefined>;
  /** Spielbildschirm im Terminal (#32). */
  gameScreen?: () => GameScreen;
  /** Handy bzw. Touch-Gerät ohne feinen Zeiger: Minigames werden nicht unterstützt (#33). */
  isMobile?: () => boolean;
  /** Dauerhafter Speicher (localStorage), z. B. für den Highscore. */
  storage?: KeyValueStore;
  /** Öffnet eine Seite in einem neuen Tab (ohne Zugriff auf diese Seite). */
  openUrl?: (url: string) => void;
  /** README eines eigenen Repos als Markdown (#89). */
  readme?: (repo: string) => Promise<string | undefined>;
}

export type ClientHandler = (ctx: CommandContext) => void | Promise<void>;

const MAX_NAME_IN_ERROR = 40;
/** Breite für umgeleitete Ausgaben (Datei statt Bildschirm): immer die breite Variante. */
const FILE_COLS = 100;

export const FS_UNAVAILABLE = 'Dateisystem nicht verfügbar (Inhalte konnten nicht geladen werden).';

export class Shell {
  readonly history = new History();
  /** Aktuelles simuliertes Verzeichnis (nur im Browser). */
  cwd = '/';
  /** Gesetzt, solange die Shell auf eine Antwort wartet (z. B. y/N). Wird statt des Prompts gezeigt. */
  inputPrompt: string | undefined;
  /** Wird aufgerufen, wenn die Shell eine Antwort erwartet (Editor zeichnet die Frage). */
  onInputRequest: (() => void) | undefined;

  private readonly out: ShellOutput;
  private readonly services: ShellServices;
  private ws: Workspace | undefined;
  private readonly ready: Promise<void>;
  private pending: ((answer: string | undefined) => void) | undefined;
  private warnedSave = false;

  constructor(
    out: ShellOutput,
    workspace?: Workspace | Promise<Workspace | undefined>,
    services: ShellServices = {},
  ) {
    this.out = out;
    this.services = services;
    this.ready = Promise.resolve(workspace).then(
      (ws) => {
        this.ws = ws;
      },
      () => {
        this.ws = undefined;
      },
    );
  }

  /** Fehlermeldung in Rot. Meldungen können Eingaben enthalten: nie ungefiltert ausgeben. */
  error(message: string): void {
    this.out.print([style.red(clean(message))]);
  }

  /** Fehler eines Commands zu einem Pfad, Format wie in einer Shell: `rm: x: Meldung`. */
  fsError(command: string, operand: string, error: unknown): void {
    const message = error instanceof VfsError ? error.message : 'Fehler';
    this.error(`${command}: ${printable(operand, 60)}: ${message}`);
  }

  /** Stellt eine Ja/Nein-Frage. Standard ist Nein; Abbruch (Ctrl+C) ist Nein. */
  async confirm(question: string, signal?: AbortSignal): Promise<boolean> {
    const answer = await this.ask(`${question} (y/N) `, signal);
    return answer !== undefined && /^(y|yes|j|ja)$/i.test(answer.trim());
  }

  private ask(prompt: string, signal?: AbortSignal): Promise<string | undefined> {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve(undefined);
      const finish = (answer: string | undefined): void => {
        this.pending = undefined;
        this.inputPrompt = undefined;
        signal?.removeEventListener('abort', onAbort);
        resolve(answer);
      };
      const onAbort = (): void => finish(undefined);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending = finish;
      this.inputPrompt = prompt;
      this.onInputRequest?.();
    });
  }

  /** Gibt eine eingegebene Zeile als Antwort weiter. `false`, wenn keine Frage offen ist. */
  answer(line: string): boolean {
    if (!this.pending) return false;
    this.pending(line);
    return true;
  }

  /** Führt eine Eingabezeile aus. `signal` bricht laufende Commands ab (Ctrl+C). */
  async execute(rawLine: string, signal?: AbortSignal): Promise<void> {
    const line = sanitizeInput(rawLine).trim();
    this.history.push(line);
    if (!line) return;

    let parsed = tokenize(line);
    if (!parsed.ok) {
      // Freitext-Commands (ask): ein einzelnes Apostroph ist kein Fehler
      const first = /^\S+/.exec(line)?.[0] ?? '';
      if (!findCommand(first)?.freeText) return this.error(parsed.error);
      // Umleitung am Ende bleibt erhalten: ask wie geht's? > antwort.txt (#76, L6)
      const rest = line.slice(first.length).trim();
      const redirect = /\s(>>?)\s*([^\s'"<>]+)$/.exec(` ${rest}`);
      parsed = redirect
        ? {
            ok: true,
            tokens: [first, ` ${rest}`.slice(0, redirect.index).trim()],
            redirect: { target: redirect[2]!, append: redirect[1] === '>>' },
          }
        : { ok: true, tokens: [first, rest] };
    }
    const [name = '', ...args] = parsed.tokens;

    const spec = findCommand(name);
    const handler =
      spec && Object.hasOwn(CLIENT_HANDLERS, spec.name) ? CLIENT_HANDLERS[spec.name] : undefined;
    if (!spec || !handler) {
      const message = `${style.red('command not found:')} ${truncate(printable(name, 200), MAX_NAME_IN_ERROR)}. Tippe '${keepTogether('help --short')}'.`;
      // Nur unser eigener Vorschlag ist klickbar, nicht etwas aus der Eingabe.
      const hint = suggestionsIn(message)
        .filter((a) => a.command === 'help --short')
        .slice(-1);
      this.out.print([message], [hint]);
      return;
    }
    const argv = parseArgs(spec, args);
    if (!argv.ok) return this.error(argv.error);
    if (parsed.redirect && !spec.redirect) {
      return this.error(`${spec.name}: Ausgabe kann nicht umgeleitet werden`);
    }

    await this.ready;
    const ws = this.ws;
    const captured: string[] = [];
    const out: ShellOutput = parsed.redirect
      ? {
          print: (l) => captured.push(...l),
          replaceLast: (l) => {
            captured[Math.max(0, captured.length - 1)] = l;
          },
          clear: () => {},
          cols: () => FILE_COLS,
        }
      : this.out;

    await handler({
      out,
      spec,
      args,
      flags: argv.flags,
      operands: argv.operands,
      shell: this,
      ws,
      signal,
      services: this.services,
    });

    let wrote = spec.writes === true;
    if (parsed.redirect) {
      if (!ws) return this.error(FS_UNAVAILABLE);
      const target = parsed.redirect.target;
      try {
        const text = captured.length ? `${captured.map(stripAnsi).join('\n')}\n` : '';
        ws.fs.writeText(ws.fs.resolve(this.cwd, target), text, {
          append: parsed.redirect.append,
        });
        wrote = true;
      } catch (error) {
        this.fsError(spec.name, target, error);
      }
    }

    if (ws) {
      // Wurde der aktuelle Ordner gelöscht oder verschoben: zurück zur Wurzel.
      if (ws.fs.get(this.cwd)?.type !== 'dir') this.cwd = '/';
      if (wrote && !ws.save() && !this.warnedSave) {
        this.warnedSave = true;
        this.out.print([
          style.yellow('Hinweis: Änderungen können in diesem Browser nicht gespeichert werden.'),
        ]);
      }
    }
  }

  /** Ersetzt die Arbeitskopie durch das Original (reset). */
  resetWorkspace(): void {
    this.ws?.reset();
    this.cwd = '/';
  }

  /**
   * Tab-Completion: erstes Wort aus der Registry, Pfad-Argumente aus dem lokalen
   * Dateisystem. Gibt die neue Eingabe zurück; bei mehreren Treffern werden die
   * Kandidaten ausgegeben.
   */
  async complete(input: string): Promise<string> {
    if (!/\s/.test(input)) {
      const names = COMMANDS.flatMap((c) => [c.name, ...c.aliases])
        .filter((n) => n.startsWith(input))
        .sort();
      return this.pick(input, '', names, (n) => n, ' ');
    }

    const spec = findCommand(input.trimStart().split(/\s+/)[0] ?? '');
    await this.ready;
    const ws = this.ws;
    const partial = /\s$/.test(input) ? '' : (input.split(/\s+/).at(-1) ?? '');
    const named = spec && Object.hasOwn(OPERAND_COMPLETIONS, spec.name);
    if (named && !partial.startsWith('-')) {
      const names = (await OPERAND_COMPLETIONS[spec.name]!({ services: this.services, ws }))
        .filter((n) => n.toLowerCase().startsWith(partial.toLowerCase()))
        .sort();
      const head = input.slice(0, input.length - partial.length);
      return this.pick(input, head, names, (n) => n, ' ');
    }
    if (!spec?.pathOperands || !ws) return input;
    if (/["'>]/.test(partial) || partial.startsWith('-')) return input;

    const slash = partial.lastIndexOf('/');
    const dirPart = slash >= 0 ? partial.slice(0, slash + 1) : '';
    const base = slash >= 0 ? partial.slice(slash + 1) : partial;
    let candidates: string[];
    try {
      const dir = ws.fs.resolve(this.cwd, dirPart === '' ? '.' : dirPart);
      candidates = ws.fs
        .list(dir)
        .filter((n) => n.name.startsWith(base) && (base.startsWith('.') || !n.name.startsWith('.')))
        .map((n) => `${dirPart}${n.name}${n.type === 'dir' ? '/' : ''}`);
    } catch {
      return input;
    }
    const head = input.slice(0, input.length - partial.length);
    const label = (c: string): string =>
      c.replace(/\/$/, '').split('/').at(-1)! + (c.endsWith('/') ? '/' : '');
    return this.pick(input, head, candidates, label, (c) => (c.endsWith('/') ? '' : ' '));
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
    this.out.print([candidates.map((c) => clean(label(c))).join('  ')]);
    const prefix = commonPrefix(candidates);
    return prefix.length > input.length - head.length ? head + prefix : input;
  }
}

function commonPrefix(words: string[]): string {
  let prefix = words[0] ?? '';
  for (const w of words) while (!w.startsWith(prefix)) prefix = prefix.slice(0, -1);
  return prefix;
}
