import { COMMANDS } from '@maxim-os/shared';
import { MSG, VfsError, type VNode } from '../vfs/vfs.ts';
import type { Workspace } from '../vfs/workspace.ts';
import { formatCat, formatLs, formatTree, type DirEntry, type TreeNode } from './format.ts';
import { formatHelp } from './help.ts';
import { FS_UNAVAILABLE, type ClientHandler, type CommandContext } from './shell.ts';
import { style } from './text.ts';

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
  const ok = await ctx.shell.confirm('Alle deine Änderungen verwerfen?', ctx.signal);
  if (!ok) return ctx.out.print(['Abgebrochen.']);
  ctx.shell.resetWorkspace();
  ctx.out.print([style.green('Originalzustand wiederhergestellt.')]);
};

function fail(message: string): never {
  throw new VfsError(message);
}

export const CLIENT_HANDLERS: Readonly<Record<string, ClientHandler>> = Object.freeze({
  help: (ctx) => ctx.out.print(formatHelp(COMMANDS, ctx.out.cols())),
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
});
