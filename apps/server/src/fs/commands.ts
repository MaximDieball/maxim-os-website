import { open, readdir } from 'node:fs/promises';
import { posix } from 'node:path';
import type { CommandResult, DirEntry, FlagValues, TreeNode } from '@maxim-os/shared';
import { NOT_A_DIR, type Sandbox } from './sandbox.ts';

/** Ausgabe-Limits (SPEC Abschnitt 5). */
export const OUTPUT_LIMITS = {
  /** Maximale Dateigröße für cat. */
  catBytes: 64 * 1024,
  /** Maximale Einträge pro ls. */
  lsEntries: 500,
  /** Maximale Knoten pro tree. */
  treeNodes: 300,
  /** Standardtiefe für tree ohne -L. */
  treeDepth: 3,
  /** Maximale Kandidaten bei der Completion. */
  completions: 50,
} as const;

export interface ServerCommandContext {
  sandbox: Sandbox;
  /** Bereits validiertes, simuliertes aktuelles Verzeichnis. */
  cwd: string;
  flags: FlagValues;
  operands: string[];
}

type Handler = (ctx: ServerCommandContext) => Promise<CommandResult>;

const err = (message: string): CommandResult => ({ kind: 'error', message });

/** Kürzt Benutzereingaben in Fehlermeldungen (kein Echo beliebig langer Strings). */
const shown = (s: string): string => (s.length > 60 ? `${s.slice(0, 59)}…` : s);

/** Sichtbare Einträge eines (geprüften) Ordners: jeder Eintrag wird selbst durch die Sandbox geprüft. */
async function listDir(
  sandbox: Sandbox,
  dirPath: string,
  real: string,
  includeHidden: boolean,
  limit: number,
): Promise<{ entries: (DirEntry & { path: string })[]; truncated: boolean }> {
  const names = (await readdir(real)).filter((n) => includeHidden || !n.startsWith('.')).sort();
  const entries: (DirEntry & { path: string })[] = [];
  for (const name of names) {
    if (entries.length >= limit) return { entries, truncated: true };
    const r = await sandbox.resolve(dirPath, name);
    if (!r.ok) continue; // verbotene Symlinks, Steuerzeichen im Namen ...
    entries.push({
      name,
      path: r.path,
      type: r.isDir ? 'dir' : 'file',
      size: r.isDir ? 0 : r.size,
      mtime: r.mtime.toISOString(),
    });
  }
  return { entries, truncated: false };
}

// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
// eslint-disable-next-line no-control-regex
const ANSI_SEQUENCE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-_]/g;

/** Text so aufbereiten, dass er im Terminal nichts steuern kann. */
export function sanitizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(ANSI_SEQUENCE, '').replace(UNSAFE_TEXT, '');
}

const ls: Handler = async ({ sandbox, cwd, flags, operands }) => {
  const target = operands[0] ?? '.';
  const r = await sandbox.resolve(cwd, target);
  if (!r.ok) return err(`ls: ${shown(target)}: ${r.error}`);
  const long = flags.l === true;
  if (!r.isDir) {
    const name = posix.basename(r.path);
    return {
      kind: 'ls',
      path: r.path,
      long,
      entries: [{ name, type: 'file', size: r.size, mtime: r.mtime.toISOString() }],
    };
  }
  const all = flags.a === true;
  const { entries } = await listDir(sandbox, r.path, r.real, all, OUTPUT_LIMITS.lsEntries);
  const out: DirEntry[] = entries.map(({ name, type, size, mtime }) => ({
    name,
    type,
    size,
    mtime,
  }));
  if (all) {
    const parent = await sandbox.resolve(r.path, '..');
    const dot = (name: string, mtime: Date): DirEntry => ({
      name,
      type: 'dir',
      size: 0,
      mtime: mtime.toISOString(),
    });
    out.unshift(dot('.', r.mtime), dot('..', parent.ok ? parent.mtime : r.mtime));
  }
  return { kind: 'ls', path: r.path, long, entries: out };
};

const cd: Handler = async ({ sandbox, cwd, operands }) => {
  const target = operands[0] ?? '/';
  const r = await sandbox.resolve(cwd, target);
  if (!r.ok) return err(`cd: ${shown(target)}: ${r.error}`);
  if (!r.isDir) return err(`cd: ${shown(target)}: ${NOT_A_DIR}`);
  return { kind: 'cd', cwd: r.path };
};

const pwd: Handler = async ({ cwd }) => ({ kind: 'pwd', cwd });

const cat: Handler = async ({ sandbox, cwd, operands }) => {
  const target = operands[0]!;
  const r = await sandbox.resolve(cwd, target);
  if (!r.ok) return err(`cat: ${shown(target)}: ${r.error}`);
  if (r.isDir) return err(`cat: ${shown(target)}: Ist ein Ordner.`);
  if (r.size > OUTPUT_LIMITS.catBytes) {
    return err(`cat: ${shown(target)}: Datei zu groß (max. ${OUTPUT_LIMITS.catBytes / 1024} KB).`);
  }
  // Höchstens Limit + 1 Byte lesen, falls die Datei seit dem stat gewachsen ist.
  const handle = await open(r.real, 'r');
  let bytes: Buffer;
  try {
    const buffer = Buffer.alloc(OUTPUT_LIMITS.catBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    bytes = buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  if (bytes.length > OUTPUT_LIMITS.catBytes) return err(`cat: ${shown(target)}: Datei zu groß.`);
  if (bytes.includes(0)) return err(`cat: ${shown(target)}: keine Textdatei.`);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return err(`cat: ${shown(target)}: keine Textdatei.`);
  }
  return { kind: 'cat', path: r.path, text: sanitizeText(text) };
};

const tree: Handler = async ({ sandbox, cwd, flags, operands }) => {
  const target = operands[0] ?? '.';
  const r = await sandbox.resolve(cwd, target);
  if (!r.ok) return err(`tree: ${shown(target)}: ${r.error}`);
  if (!r.isDir) return err(`tree: ${shown(target)}: ${NOT_A_DIR}`);
  const maxDepth = typeof flags.L === 'number' ? flags.L : OUTPUT_LIMITS.treeDepth;

  let nodes = 0;
  let dirs = 0;
  let files = 0;
  let truncated = false;

  const build = async (path: string, real: string, depth: number): Promise<TreeNode[]> => {
    const budget = OUTPUT_LIMITS.treeNodes - nodes;
    const listed = await listDir(sandbox, path, real, false, Math.max(0, budget));
    if (listed.truncated) truncated = true;
    const children: TreeNode[] = [];
    for (const entry of listed.entries) {
      nodes++;
      if (entry.type === 'dir') {
        dirs++;
        const node: TreeNode = { name: entry.name, type: 'dir' };
        if (depth < maxDepth) {
          const child = await sandbox.resolve(entry.path, '.');
          if (child.ok) node.children = await build(child.path, child.real, depth + 1);
        }
        children.push(node);
      } else {
        files++;
        children.push({ name: entry.name, type: 'file' });
      }
    }
    return children;
  };

  const root: TreeNode = {
    name: target === '.' ? '.' : shown(target),
    type: 'dir',
    children: await build(r.path, r.real, 1),
  };
  return { kind: 'tree', path: r.path, root, dirs, files, truncated };
};

/** Serverseitige Handler, Schlüssel ist der Registry-Name. */
export const SERVER_HANDLERS: ReadonlyMap<string, Handler> = new Map([
  ['ls', ls],
  ['cd', cd],
  ['pwd', pwd],
  ['cat', cat],
  ['tree', tree],
]);

/** Pfad-Vervollständigung für Tab. Gibt simulierte Kandidaten zurück, Ordner mit "/". */
export async function completePath(
  sandbox: Sandbox,
  cwd: string,
  partial: string,
): Promise<string[]> {
  const slash = partial.lastIndexOf('/');
  const dirPart = slash >= 0 ? partial.slice(0, slash + 1) : '';
  const base = slash >= 0 ? partial.slice(slash + 1) : partial;
  const dir = await sandbox.resolve(cwd, dirPart === '' ? '.' : dirPart);
  if (!dir.ok || !dir.isDir) return [];
  const { entries } = await listDir(
    sandbox,
    dir.path,
    dir.real,
    base.startsWith('.'),
    OUTPUT_LIMITS.lsEntries,
  );
  return entries
    .filter((e) => e.name.startsWith(base))
    .slice(0, OUTPUT_LIMITS.completions)
    .map((e) => `${dirPart}${e.name}${e.type === 'dir' ? '/' : ''}`);
}
