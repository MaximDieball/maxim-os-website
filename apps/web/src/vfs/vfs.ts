import { isValidName, NAME_LIMITS, type FsDir, type FsNode } from '@maxim-os/shared';

/**
 * Virtuelles Dateisystem im Browser (SPEC v4, Abschnitt 2). Es wird aus dem
 * Snapshot des Servers aufgebaut, alle Commands arbeiten nur auf dieser Kopie.
 * Pfade sind immer absolut und normalisiert (siehe `resolve`).
 */

export interface VFile {
  type: 'file';
  name: string;
  mtime: number;
  size: number;
  text?: string;
  binary?: boolean;
}

export interface VDir {
  type: 'dir';
  name: string;
  mtime: number;
  children: Map<string, VNode>;
}

export type VNode = VFile | VDir;

export interface VfsLimits {
  fileBytes: number;
  totalBytes: number;
  entries: number;
}

export const VFS_LIMITS: VfsLimits = {
  fileBytes: 64 * 1024,
  totalBytes: 1024 * 1024,
  entries: 2000,
};

export class VfsError extends Error {}

export const MSG = {
  notFound: 'Datei oder Ordner nicht gefunden',
  notDir: 'Kein Ordner',
  isDir: 'Ist ein Ordner',
  exists: 'Existiert bereits',
  notEmpty: 'Ordner ist nicht leer',
  invalidName: 'Ungültiger Name',
  pathTooLong: 'Pfad zu lang',
  root: 'Die Wurzel / kann nicht verändert werden',
  intoSelf: 'Ziel liegt in der Quelle',
  binary: 'Binärdatei, kann nicht angezeigt werden',
} as const;

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;

const fail = (message: string): never => {
  throw new VfsError(message);
};

/** Zerlegt einen absoluten, normalisierten Pfad in Segmente ("/" -> []). */
const segments = (path: string): string[] => path.split('/').filter(Boolean);
const parentOf = (path: string): string => '/' + segments(path).slice(0, -1).join('/');
const baseName = (path: string): string => segments(path).at(-1) ?? '';
const join = (dir: string, name: string): string => (dir === '/' ? `/${name}` : `${dir}/${name}`);

function cloneNode(node: VNode): VNode {
  if (node.type === 'file') return { ...node };
  return {
    ...node,
    children: new Map([...node.children].map(([k, v]) => [k, cloneNode(v)])),
  };
}

/** Anzahl Einträge und Text-Bytes eines Teilbaums (der Knoten selbst zählt mit). */
function measure(node: VNode): { entries: number; bytes: number } {
  if (node.type === 'file') return { entries: 1, bytes: node.binary ? 0 : node.size };
  let entries = 1;
  let bytes = 0;
  for (const child of node.children.values()) {
    const m = measure(child);
    entries += m.entries;
    bytes += m.bytes;
  }
  return { entries, bytes };
}

function fromFsNode(node: FsNode): VNode | undefined {
  if (!isValidName(node.name)) return undefined;
  const mtime = Date.parse(node.mtime) || Date.now();
  if (node.type === 'file') {
    return node.binary || node.text === undefined
      ? { type: 'file', name: node.name, mtime, size: node.size, binary: true }
      : { type: 'file', name: node.name, mtime, size: byteLength(node.text), text: node.text };
  }
  const dir: VDir = { type: 'dir', name: node.name, mtime, children: new Map() };
  for (const child of node.children) {
    const v = fromFsNode(child);
    if (v) dir.children.set(v.name, v);
  }
  return dir;
}

function toFsNode(node: VNode): FsNode {
  const mtime = new Date(node.mtime).toISOString();
  if (node.type === 'file') {
    return node.binary
      ? { type: 'file', name: node.name, mtime, size: node.size, binary: true }
      : { type: 'file', name: node.name, mtime, size: node.size, text: node.text ?? '' };
  }
  return {
    type: 'dir',
    name: node.name,
    mtime,
    children: [...node.children.values()]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(toFsNode),
  };
}

export class Vfs {
  private readonly root: VDir;
  private readonly limits: VfsLimits;
  private entries: number;
  private bytes: number;

  private constructor(root: VDir, limits: VfsLimits) {
    this.root = root;
    this.limits = limits;
    const m = measure(root);
    this.entries = m.entries - 1; // die Wurzel zählt nicht
    this.bytes = m.bytes;
  }

  static fromSnapshot(root: FsDir, limits: Partial<VfsLimits> = {}): Vfs {
    const dir: VDir = {
      type: 'dir',
      name: '',
      mtime: Date.parse(root.mtime) || Date.now(),
      children: new Map(),
    };
    for (const child of root.children) {
      const v = fromFsNode(child);
      if (v) dir.children.set(v.name, v);
    }
    return new Vfs(dir, { ...VFS_LIMITS, ...limits });
  }

  toSnapshot(): FsDir {
    return toFsNode(this.root) as FsDir;
  }

  /** Belegter Platz (für Anzeigen und Tests). */
  usage(): { entries: number; bytes: number } {
    return { entries: this.entries, bytes: this.bytes };
  }

  /**
   * Löst `input` relativ zu `cwd` auf: absolut ab "/", ".." endet an "/", "~" ist "/".
   * Prüft jeden Namen und die Gesamtlänge. Ob der Pfad existiert, prüft `resolve` nicht.
   */
  resolve(cwd: string, input: string): string {
    const expanded = input === '~' ? '/' : input.startsWith('~/') ? input.slice(1) : input;
    const parts = expanded.startsWith('/') ? [] : segments(cwd);
    for (const part of expanded.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') parts.pop();
      else if (!isValidName(part)) fail(MSG.invalidName);
      else parts.push(part);
    }
    const path = '/' + parts.join('/');
    if (path.length > NAME_LIMITS.path) fail(MSG.pathTooLong);
    return path;
  }

  get(path: string): VNode | undefined {
    let node: VNode = this.root;
    for (const part of segments(path)) {
      if (node.type !== 'dir') return undefined;
      const next = node.children.get(part);
      if (!next) return undefined;
      node = next;
    }
    return node;
  }

  private dir(path: string): VDir {
    const node = this.get(path) ?? fail(MSG.notFound);
    return node.type === 'dir' ? node : fail(MSG.notDir);
  }

  /** Elternordner eines (noch nicht existierenden) Pfads. */
  private parentDir(path: string): VDir {
    const parentPath = parentOf(path);
    const parent = this.get(parentPath);
    if (!parent) return fail(MSG.notFound);
    return parent.type === 'dir' ? parent : fail(MSG.notDir);
  }

  list(path: string): VNode[] {
    return [...this.dir(path).children.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }

  readText(path: string): string {
    const node = this.get(path) ?? fail(MSG.notFound);
    if (node.type === 'dir') return fail(MSG.isDir);
    if (node.binary) return fail(MSG.binary);
    return node.text ?? '';
  }

  /** Prüft, ob ein Zuwachs um `entries` Einträge und `bytes` Bytes erlaubt ist. */
  private reserve(entries: number, bytes: number): void {
    if (entries > 0 && this.entries + entries > this.limits.entries) {
      fail(`Zu viele Einträge (max. ${this.limits.entries})`);
    }
    if (bytes > 0 && this.bytes + bytes > this.limits.totalBytes) {
      fail(`Kein Platz mehr (max. ${Math.round(this.limits.totalBytes / 1024)} KB)`);
    }
  }

  private account(entries: number, bytes: number): void {
    this.entries += entries;
    this.bytes += bytes;
  }

  mkdir(path: string, options: { parents?: boolean } = {}): void {
    if (!options.parents) {
      if (this.get(path)) fail(MSG.exists);
      const parent = this.parentDir(path);
      this.reserve(1, 0);
      parent.children.set(baseName(path), {
        type: 'dir',
        name: baseName(path),
        mtime: Date.now(),
        children: new Map(),
      });
      this.account(1, 0);
      return;
    }
    const existing = this.get(path);
    if (existing) {
      if (existing.type !== 'dir') fail(MSG.exists);
      return;
    }
    let current = '/';
    for (const part of segments(path)) {
      current = join(current, part);
      const node = this.get(current);
      if (node && node.type !== 'dir') fail(MSG.notDir);
      if (!node) this.mkdir(current);
    }
  }

  writeText(path: string, text: string, options: { append?: boolean } = {}): void {
    if (path === '/') fail(MSG.isDir);
    const node = this.get(path);
    if (node?.type === 'dir') fail(MSG.isDir);
    const existing = node?.type === 'file' ? node : undefined;
    const parent = this.parentDir(path);
    const oldText = existing && !existing.binary ? (existing.text ?? '') : '';
    const next = options.append ? oldText + text : text;
    const size = byteLength(next);
    if (size > this.limits.fileBytes) {
      fail(`Datei zu groß (max. ${Math.round(this.limits.fileBytes / 1024)} KB)`);
    }
    const oldBytes = existing && !existing.binary ? existing.size : 0;
    this.reserve(existing ? 0 : 1, size - oldBytes);
    const name = baseName(path);
    parent.children.set(name, { type: 'file', name, mtime: Date.now(), size, text: next });
    parent.mtime = Date.now();
    this.account(existing ? 0 : 1, size - oldBytes);
  }

  touch(path: string): void {
    const existing = this.get(path);
    if (existing) {
      existing.mtime = Date.now();
      return;
    }
    this.writeText(path, '');
  }

  remove(path: string, options: { recursive?: boolean; force?: boolean } = {}): void {
    if (path === '/') fail(MSG.root);
    const node = this.get(path);
    if (!node) {
      if (options.force) return;
      fail(MSG.notFound);
    }
    if (node!.type === 'dir' && !options.recursive) fail(MSG.isDir);
    const parent = this.parentDir(path);
    const m = measure(node!);
    parent.children.delete(baseName(path));
    parent.mtime = Date.now();
    this.account(-m.entries, -m.bytes);
  }

  rmdir(path: string): void {
    if (path === '/') fail(MSG.root);
    const node = this.get(path) ?? fail(MSG.notFound);
    if (node.type !== 'dir') fail(MSG.notDir);
    if ((node as VDir).children.size > 0) fail(MSG.notEmpty);
    this.remove(path, { recursive: true });
  }

  /** Ziel für mv/cp: in einen existierenden Ordner hinein, sonst der Pfad selbst. */
  private target(src: string, dst: string): string {
    const node = this.get(dst);
    return node?.type === 'dir' ? join(dst, baseName(src)) : dst;
  }

  private checkTransfer(src: string, dst: string): { node: VNode; to: string } {
    if (src === '/') fail(MSG.root);
    const node = this.get(src) ?? fail(MSG.notFound);
    const to = this.target(src, dst);
    if (node.type === 'dir' && (to === src || to.startsWith(`${src}/`))) fail(MSG.intoSelf);
    if (to === '/') fail(MSG.root);
    const existing = this.get(to);
    if (existing && existing !== node) {
      if (node.type === 'dir' && existing.type !== 'dir') fail(MSG.notDir);
      if (node.type === 'file' && existing.type === 'dir') fail(MSG.isDir);
      if (existing.type === 'dir') fail(MSG.exists);
    }
    this.parentDir(to);
    return { node, to };
  }

  move(src: string, dst: string): void {
    const { node, to } = this.checkTransfer(src, dst);
    if (to === src) return;
    const target = this.parentDir(to);
    const replaced = this.get(to);
    const freed = replaced ? measure(replaced) : { entries: 0, bytes: 0 };
    this.parentDir(src).children.delete(node.name);
    const name = baseName(to);
    node.name = name;
    target.children.set(name, node);
    target.mtime = Date.now();
    this.account(-freed.entries, -freed.bytes);
  }

  copy(src: string, dst: string, options: { recursive?: boolean } = {}): void {
    const { node, to } = this.checkTransfer(src, dst);
    if (node.type === 'dir' && !options.recursive) fail(MSG.isDir);
    if (to === src) fail(MSG.exists);
    const copy = cloneNode(node);
    const m = measure(copy);
    const replaced = this.get(to);
    const freed = replaced ? measure(replaced) : { entries: 0, bytes: 0 };
    this.reserve(m.entries - freed.entries, m.bytes - freed.bytes);
    const name = baseName(to);
    copy.name = name;
    copy.mtime = Date.now();
    const target = this.parentDir(to);
    target.children.set(name, copy);
    target.mtime = Date.now();
    this.account(m.entries - freed.entries, m.bytes - freed.bytes);
  }
}
