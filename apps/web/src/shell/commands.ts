import { ASK_LIMITS, COMMANDS, findCommand, type AskMessage } from '@maxim-os/shared';
import { MSG, VfsError, type VNode } from '../vfs/vfs.ts';
import type { Workspace } from '../vfs/workspace.ts';
import { clean, formatCat, formatLs, formatTree, type DirEntry, type TreeNode } from './format.ts';
import { formatProject, formatProjects, formatSteckbrief } from '../profile/format.ts';
import {
  parseFacts,
  parseProfileData,
  parseProjectLinks,
  type GithubData,
} from '../profile/github.ts';
import { runSnake } from '../games/run-snake.ts';
import { formatMinecraft } from '../minecraft/status.ts';
import { formatCommandHelp, formatHelp, formatHelpShort } from './help.ts';
import { keepTogether, withSuggestions } from './suggest.ts';
import { FS_UNAVAILABLE, type ClientHandler, type CommandContext } from './shell.ts';
import { stripAnsi, style, wrap } from './text.ts';

/**
 * Alle Command-Handler, Schlüssel ist der Registry-Name. Flags und Argumente sind
 * vorher schon gegen die Registry geprüft (parseArgs in Shell.execute). Normale
 * Ausgabe geht an ctx.out (umleitbar), Fehler an ctx.shell.error.
 */

/** Ausgabelimits für tree (SPEC: Tiefen- und Ausgabelimit). */
export const TREE_LIMITS = { depth: 3, nodes: 300 } as const;

function needFs(ctx: CommandContext): Workspace | undefined {
  if (!ctx.ws) ctx.shell.error(`${ctx.spec.name}: ${FS_UNAVAILABLE}`);
  return ctx.ws;
}

/** Führt `fn` für jeden Pfad aus; Fehler pro Pfad wie in einer Shell. */
function eachPath(
  ctx: CommandContext,
  ws: Workspace,
  fn: (path: string, raw: string) => void,
): void {
  for (const raw of ctx.operands) {
    try {
      fn(ws.fs.resolve(ctx.shell.cwd, raw), raw);
    } catch (error) {
      ctx.shell.fsError(ctx.spec.name, raw, error);
    }
  }
}

const toEntry = (node: VNode, name = node.name): DirEntry => ({
  name,
  type: node.type,
  size: node.type === 'file' ? node.size : 0,
  mtime: new Date(node.mtime).toISOString(),
});

const ls: ClientHandler = (ctx) => {
  const ws = needFs(ctx);
  if (!ws) return;
  const raw = ctx.operands[0] ?? '.';
  try {
    const path = ws.fs.resolve(ctx.shell.cwd, raw);
    const node = ws.fs.get(path) ?? fail(MSG.notFound);
    const long = ctx.flags.l === true;
    if (node.type === 'file') return ctx.out.print(formatLs([toEntry(node)], long, ctx.out.cols()));
    const all = ctx.flags.a === true;
    const entries = ws.fs
      .list(path)
      .filter((n) => all || !n.name.startsWith('.'))
      .map((n) => toEntry(n));
    if (all) {
      const parent = ws.fs.get(ws.fs.resolve(path, '..'))!;
      entries.unshift(toEntry(node, '.'), toEntry(parent, '..'));
    }
    ctx.out.print(formatLs(entries, long, ctx.out.cols()));
  } catch (error) {
    ctx.shell.fsError('ls', raw, error);
  }
};

const cd: ClientHandler = (ctx) => {
  const ws = needFs(ctx);
  if (!ws) return;
  const raw = ctx.operands[0] ?? '/';
  try {
    const path = ws.fs.resolve(ctx.shell.cwd, raw);
    const node = ws.fs.get(path) ?? fail(MSG.notFound);
    if (node.type !== 'dir') fail(MSG.notDir);
    ctx.shell.cwd = path;
  } catch (error) {
    ctx.shell.fsError('cd', raw, error);
  }
};

const cat: ClientHandler = (ctx) => {
  const ws = needFs(ctx);
  if (!ws) return;
  eachPath(ctx, ws, (path) => ctx.out.print(formatCat(ws.fs.readText(path))));
};

const tree: ClientHandler = (ctx) => {
  const ws = needFs(ctx);
  if (!ws) return;
  const raw = ctx.operands[0] ?? '.';
  const maxDepth = typeof ctx.flags.L === 'number' ? ctx.flags.L : TREE_LIMITS.depth;
  let nodes = 0;
  let dirs = 0;
  let files = 0;
  let truncated = false;
  const build = (path: string, depth: number): TreeNode[] => {
    const children: TreeNode[] = [];
    for (const node of ws.fs.list(path)) {
      if (node.name.startsWith('.')) continue;
      if (nodes >= TREE_LIMITS.nodes) {
        truncated = true;
        break;
      }
      nodes++;
      if (node.type === 'dir') {
        dirs++;
        const child: TreeNode = { name: node.name, type: 'dir' };
        if (depth < maxDepth) child.children = build(ws.fs.resolve(path, node.name), depth + 1);
        children.push(child);
      } else {
        files++;
        children.push({ name: node.name, type: 'file' });
      }
    }
    return children;
  };
  try {
    const path = ws.fs.resolve(ctx.shell.cwd, raw);
    const node = ws.fs.get(path) ?? fail(MSG.notFound);
    if (node.type !== 'dir') fail(MSG.notDir);
    const root: TreeNode = { name: raw === '.' ? '.' : raw, type: 'dir', children: build(path, 1) };
    ctx.out.print(formatTree(root, dirs, files, truncated, ctx.out.cols()));
  } catch (error) {
    ctx.shell.fsError('tree', raw, error);
  }
};

const mkdir: ClientHandler = (ctx) => {
  const ws = needFs(ctx);
  if (ws) eachPath(ctx, ws, (path) => ws.fs.mkdir(path, { parents: ctx.flags.p === true }));
};

const touch: ClientHandler = (ctx) => {
  const ws = needFs(ctx);
  if (ws) eachPath(ctx, ws, (path) => ws.fs.touch(path));
};

const rm: ClientHandler = (ctx) => {
  const ws = needFs(ctx);
  if (!ws) return;
  eachPath(ctx, ws, (path) => {
    try {
      ws.fs.remove(path, { recursive: ctx.flags.r === true, force: ctx.flags.f === true });
    } catch (error) {
      // Hinweis wie bei rm: Ordner brauchen -r.
      if (error instanceof VfsError && error.message === MSG.isDir) {
        throw new VfsError(`${MSG.isDir} (rm -r verwenden)`);
      }
      throw error;
    }
  });
};

const rmdir: ClientHandler = (ctx) => {
  const ws = needFs(ctx);
  if (ws) eachPath(ctx, ws, (path) => ws.fs.rmdir(path));
};

/** mv und cp: Quelle und Ziel auflösen, Fehler beziehen sich auf die Quelle. */
function transfer(
  ctx: CommandContext,
  op: (ws: Workspace, src: string, dst: string) => void,
): void {
  const ws = needFs(ctx);
  if (!ws) return;
  const [rawSrc = '', rawDst = ''] = ctx.operands;
  try {
    const src = ws.fs.resolve(ctx.shell.cwd, rawSrc);
    const dst = ws.fs.resolve(ctx.shell.cwd, rawDst);
    op(ws, src, dst);
  } catch (error) {
    ctx.shell.fsError(ctx.spec.name, rawSrc, error);
  }
}

const mv: ClientHandler = (ctx) => transfer(ctx, (ws, src, dst) => ws.fs.move(src, dst));
const cp: ClientHandler = (ctx) =>
  transfer(ctx, (ws, src, dst) => ws.fs.copy(src, dst, { recursive: ctx.flags.r === true }));

const echo: ClientHandler = (ctx) => ctx.out.print([ctx.operands.join(' ')]);

const reset: ClientHandler = async (ctx) => {
  if (!needFs(ctx)) return;
  const ok = await ctx.shell.confirm('Änderungen verwerfen?', ctx.signal);
  if (!ok) return ctx.out.print(['Abgebrochen.']);
  ctx.shell.resetWorkspace();
  ctx.out.print([style.green('Originalzustand wiederhergestellt.')]);
};

/** Zeilen einer Datei aus der lokalen Kopie, oder undefined. */
function readLines(ws: Workspace | undefined, path: string): string[] | undefined {
  try {
    const text = ws?.fs.readText(path);
    return text === undefined ? undefined : text.replace(/\n$/, '').split('\n');
  } catch {
    return undefined;
  }
}

/**
 * GitHub-Daten, sonst der Fallback aus content/about/steckbrief.json. Eigene Fakten
 * (z. B. Studium, #91) kommen immer aus der Datei.
 */
export async function profileData(
  ctx: Pick<CommandContext, 'services' | 'ws'>,
): Promise<GithubData | undefined> {
  let file: unknown;
  try {
    const raw = ctx.ws?.fs.readText('/about/steckbrief.json');
    file = raw ? JSON.parse(raw) : undefined;
  } catch {
    file = undefined;
  }
  const data = (await ctx.services.github?.()) ?? parseProfileData(file);
  if (!data) return undefined;
  // Produkt- und Download-Seiten (#95) kommen immer aus der Datei
  const links = parseProjectLinks(file);
  const repos = data.repos.map((r) => {
    const extra = links.get(r.name.toLowerCase());
    return extra ? { ...r, links: extra } : r;
  });
  return { ...data, repos, facts: parseFacts(file) };
}

const NO_PROFILE = 'Daten nicht verfügbar (GitHub nicht erreichbar, kein Fallback).';

const steckbrief: ClientHandler = async (ctx) => {
  const data = await profileData(ctx);
  if (!data) return ctx.shell.error(`steckbrief: ${NO_PROFILE}`);
  const portrait = {
    wide: readLines(ctx.ws, '/about/portrait.txt'),
    narrow: readLines(ctx.ws, '/about/portrait-narrow.txt'),
  };
  const { lines, actions } = formatSteckbrief(data, portrait, ctx.out.cols());
  ctx.out.print(lines, actions);
};

const projects: ClientHandler = async (ctx) => {
  const data = await profileData(ctx);
  if (!data) return ctx.shell.error(`projects: ${NO_PROFILE}`);
  const { lines, actions } = formatProjects(data.repos, ctx.out.cols());
  ctx.out.print(lines, actions);
};

const project: ClientHandler = async (ctx) => {
  const data = await profileData(ctx);
  if (!data) return ctx.shell.error(`project: ${NO_PROFILE}`);
  const wanted = ctx.operands[0]!;
  const repo = data.repos.find((r) => r.name.toLowerCase() === wanted.toLowerCase());
  if (!repo) {
    ctx.shell.error(`project: ${wanted}: Projekt nicht gefunden. Vorhanden:`);
    const list = formatProjects(data.repos, ctx.out.cols());
    return ctx.out.print(list.lines, list.actions);
  }
  const readme = await ctx.services.readme?.(repo.name);
  if (ctx.signal?.aborted) return;
  const { lines, actions } = formatProject(
    repo,
    readme,
    ctx.out.cols(),
    data.source === 'fallback' && readme === undefined,
  );
  ctx.out.print(lines, actions);
};

export const WATCH_URL = 'https://movies.maxim-dieball.de';

/** Wartet, bricht bei Ctrl+C sofort ab. */
const defaultDelay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** ASCII-Ladebalken, z. B. "[██████░░░░]  60%". */
export function progressBar(fraction: number, width: number): string {
  const done = Math.round(Math.min(1, Math.max(0, fraction)) * width);
  const pct = `${Math.round(fraction * 100)}%`.padStart(4);
  return `[${style.cyan('█'.repeat(done))}${style.dim('░'.repeat(width - done))}] ${pct}`;
}

/**
 * `watchthis` (#34): kurzer Ladebalken, dann movies.maxim-dieball.de im neuen Tab.
 * Kurz gehalten (unter 1 s), damit der Browser den Tab noch der Eingabe zuordnet;
 * blockiert er trotzdem, bleibt der klickbare Link.
 */
const watchthis: ClientHandler = async (ctx) => {
  const delay = ctx.services.delay ?? defaultDelay;
  const width = Math.max(10, Math.min(30, ctx.out.cols() - 8));
  ctx.out.print([
    `${style.bold('WatchThis')}  ${style.dim('verbinde mit movies.maxim-dieball.de …')}`,
    progressBar(0, width),
  ]);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await delay(60, ctx.signal);
    if (ctx.signal?.aborted) return;
    ctx.out.replaceLast?.(progressBar(i / steps, width));
  }
  ctx.services.openUrl?.(WATCH_URL);
  ctx.out.print([
    `${style.green('✓')} In einem neuen Tab geöffnet.`,
    style.dim('Kein neuer Tab? Hier klicken:'),
    style.link(WATCH_URL),
  ]);
};

/** Gesprächsverlauf pro Shell, nur im Speicher (SPEC 4b: letzte 4 Paare). */
const askHistory = new WeakMap<object, AskMessage[]>();

/** Antwort-Text als Zeilen: Absätze bleiben, jeder Absatz bricht auf die Breite um. */
const answerLines = (text: string, width: number): string[] =>
  clean(text.replace(/\r/g, ''))
    .split('\n')
    .flatMap((p) => (p.trim() ? wrap(p, width) : ['']));

/**
 * `ask` (#74): fragt den KI-Assistenten und zeigt die Antwort Wort für Wort. Weil der
 * Umbruch gierig ist, ändert sich beim Streamen nur die letzte Zeile: sie wird ersetzt,
 * neue Zeilen werden angehängt.
 */
const ask: ClientHandler = async (ctx) => {
  const service = ctx.services.ask;
  if (!service) return ctx.shell.error('ask: hier nicht verfügbar.');
  let args = [...ctx.operands];
  const fresh = args[0] === '-n';
  if (fresh) {
    args = args.slice(1);
    askHistory.delete(ctx.shell);
  }
  const question = args.join(' ').trim();
  if (!question) {
    if (fresh) return ctx.out.print([style.dim('Neues Gespräch. Frag einfach: ask <frage>')]);
    return ctx.shell.error('ask: Frage fehlt. Beispiel: ask Woran arbeitet Maxim gerade?');
  }
  if (question.length > ASK_LIMITS.userChars) {
    return ctx.shell.error(`ask: Frage zu lang (höchstens ${ASK_LIMITS.userChars} Zeichen).`);
  }

  const history = askHistory.get(ctx.shell) ?? [];
  const messages: AskMessage[] = [...history, { role: 'user', content: question }];
  // Gesamtbudget des Servers einhalten: älteste Paare zuerst weglassen (#76, L4)
  const size = (): number => messages.reduce((n, m) => n + m.content.length, 0);
  while (messages.length > 1 && size() > ASK_LIMITS.totalChars) messages.splice(0, 2);
  const width = Math.max(20, ctx.out.cols() - 1);
  ctx.out.print([style.dim('denkt nach …')]);
  let text = '';
  let shown = 0;
  const render = (): void => {
    const lines = answerLines(text, width);
    if (!lines.length) return;
    // Die letzte schon gezeigte Zeile (bzw. „denkt nach …“) ersetzen, den Rest anhängen
    const from = Math.max(0, shown - 1);
    ctx.out.replaceLast?.(lines[from]!);
    if (lines.length > from + 1) ctx.out.print(lines.slice(from + 1));
    shown = lines.length;
  };

  const result = await service(
    messages,
    (chunk) => {
      text += chunk;
      render();
    },
    ctx.signal,
  );
  if (ctx.signal?.aborted) return;
  if (!result.ok) {
    ctx.out.replaceLast?.(style.dim('…'));
    return ctx.shell.error(result.error);
  }
  if (!text.trim()) {
    ctx.out.replaceLast?.(style.dim('(keine Antwort)'));
    return;
  }
  // Verlauf: nur vollständige Paare, höchstens ASK_LIMITS.historyPairs
  const answer = result.text.trim().slice(0, ASK_LIMITS.assistantChars);
  askHistory.set(
    ctx.shell,
    [...messages, { role: 'assistant' as const, content: answer }].slice(
      -ASK_LIMITS.historyPairs * 2,
    ),
  );
};

/** `minecraft` (#36): Status über den Website-Server, der den Minecraft-Server pingt. */
const minecraft: ClientHandler = async (ctx) => {
  const load = ctx.services.minecraft;
  if (!load) return ctx.shell.error('minecraft: hier nicht verfügbar.');
  ctx.out.print([style.dim('Frage den Minecraft-Server …')]);
  const status = await load(ctx.signal);
  if (ctx.signal?.aborted) return;
  if (!status) {
    ctx.out.replaceLast?.(style.dim('…'));
    return ctx.shell.error('minecraft: Status gerade nicht abrufbar. Bitte später nochmal.');
  }
  const { lines, actions } = formatMinecraft(status, ctx.out.cols());
  // Die Warte-Zeile durch die erste Zeile ersetzen
  ctx.out.replaceLast?.(lines[0]!);
  ctx.out.print(
    ctx.out.replaceLast ? lines.slice(1) : lines,
    ctx.out.replaceLast ? actions.slice(1) : actions,
  );
};

/**
 * `snake` (#32). Auf Handys zuerst eine Warnung mit (y/N), Standard ist Abbruch (#33):
 * Es gibt keine Touch-Steuerung.
 */
const snake: ClientHandler = async (ctx) => {
  const screen = ctx.services.gameScreen?.();
  if (!screen) return ctx.shell.error('snake: Spiele sind hier nicht verfügbar.');
  if (ctx.services.isMobile?.()) {
    const ok = await ctx.shell.confirm(
      `${style.yellow('⚠')} Snake wird auf Handys nicht unterstützt. Trotzdem starten?`,
      ctx.signal,
    );
    if (!ok) return ctx.out.print([style.dim('Abgebrochen.')]);
  }
  const result = await runSnake(screen, {
    signal: ctx.signal,
    storage: ctx.services.storage,
    delay: ctx.services.delay,
  });
  if (!result.ok) {
    return ctx.shell.error('snake: Das Terminal ist zu klein für das Spielfeld.');
  }
  const { lines, actions } = withSuggestions([
    `Snake beendet. Score ${result.score} · Highscore ${result.highscore}`,
    style.dim("Nochmal: 'snake'"),
  ]);
  ctx.out.print(lines, actions);
};

/** Vervollständigung für Operanden, die keine Pfade sind (z. B. Projektnamen). */
export const OPERAND_COMPLETIONS: Readonly<
  Record<string, (ctx: Pick<CommandContext, 'services' | 'ws'>) => Promise<string[]>>
> = Object.freeze({
  project: async (ctx) => (await profileData(ctx))?.repos.map((r) => r.name) ?? [],
  help: async () => COMMANDS.map((c) => c.name),
});

const ABOUT_DEFAULT = [
  'MAXIM OS ist meine persönliche Website im Stil eines Terminals.',
  `Tippe '${keepTogether('help --short')}' für eine Übersicht oder 'steckbrief', um mich kennenzulernen.`,
];

/** Zeilen wie "  steckbrief   wer ich bin" (Liste in about.txt): der Command ist klickbar. */
function listedCommands(lines: string[]): ReturnType<typeof withSuggestions> {
  const out = withSuggestions(lines);
  lines.forEach((line, i) => {
    const m = /^(\s+)([a-z][\w-]*)\s{2,}\S/.exec(stripAnsi(line));
    if (m && findCommand(m[2]!) && !out.actions[i]) {
      out.actions[i] = { command: m[2]!, from: m[1]!.length, to: m[1]!.length + m[2]!.length };
    }
  });
  return out;
}

const help: ClientHandler = (ctx) => {
  const cols = ctx.out.cols();
  const name = ctx.operands[0];
  let result;
  if (name !== undefined) {
    const spec = findCommand(name);
    if (!spec) {
      ctx.shell.error(`help: ${name}: Unbekannter Command.`);
      const hint = withSuggestions([style.dim(`Übersicht: '${keepTogether('help --short')}'`)]);
      return ctx.out.print(hint.lines, hint.actions);
    }
    result = formatCommandHelp(spec, cols);
  } else {
    result = ctx.flags.s ? formatHelpShort(COMMANDS, cols) : formatHelp(COMMANDS, cols);
  }
  ctx.out.print(result.lines, result.actions);
};

const about: ClientHandler = (ctx) => {
  const text = readLines(ctx.ws, '/about/about.txt');
  const { lines, actions } = listedCommands(
    text ? formatCat(`${text.join('\n')}\n`) : ABOUT_DEFAULT,
  );
  ctx.out.print(lines, actions);
};

const whoami: ClientHandler = (ctx) => {
  const { lines, actions } = withSuggestions([
    'guest',
    style.dim("Du bist Gast in MAXIM OS. Wer ich bin: 'steckbrief'"),
  ]);
  ctx.out.print(lines, actions);
};

const history: ClientHandler = (ctx) => {
  const entries = ctx.shell.history.entries();
  ctx.out.print(entries.map((e, i) => `${String(i + 1).padStart(4)}  ${clean(e)}`));
};

function fail(message: string): never {
  throw new VfsError(message);
}

export const CLIENT_HANDLERS: Readonly<Record<string, ClientHandler>> = Object.freeze({
  help,
  clear: (ctx) => ctx.out.clear(),
  ls,
  cd,
  pwd: (ctx) => ctx.out.print([ctx.shell.cwd]),
  cat,
  tree,
  mkdir,
  touch,
  rm,
  rmdir,
  mv,
  cp,
  echo,
  reset,
  steckbrief,
  projects,
  project,
  watchthis,
  minecraft,
  ask,
  snake,
  about,
  whoami,
  history,
});
