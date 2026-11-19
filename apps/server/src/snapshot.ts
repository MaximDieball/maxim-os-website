import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isValidName,
  SNAPSHOT_LIMITS,
  type FsDir,
  type FsNode,
  type Snapshot,
} from '@maxim-os/shared';

/**
 * Snapshot-Generator (Sicherheitsregel 3): liest nur Ordner und reguläre Dateien
 * innerhalb des Content-Ordners, folgt keinen Symlinks, hält feste Limits ein und
 * gibt nur relative Namen aus, nie Hostpfade.
 */

export type SnapshotLimits = { [K in keyof typeof SNAPSHOT_LIMITS]: number };

export interface SnapshotOptions extends Partial<SnapshotLimits> {
  /** Meldet übersprungene Einträge (ohne Hostpfade). */
  onSkip?: (path: string, reason: string) => void;
}

const decoder = new TextDecoder('utf-8', { fatal: true });

/** Text, wenn UTF-8 ohne Null-Bytes; sonst undefined (Binärdatei). */
function asText(bytes: Buffer): string | undefined {
  if (bytes.includes(0)) return undefined;
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

export async function buildSnapshot(
  contentDir: string,
  options: SnapshotOptions = {},
): Promise<Snapshot> {
  const limits: SnapshotLimits = { ...SNAPSHOT_LIMITS, ...options };
  const skip = options.onSkip ?? (() => {});
  const root = await realpath(contentDir);
  const rootInfo = await stat(root);
  if (!rootInfo.isDirectory()) throw new Error('Content-Ordner ist kein Ordner');

  let entries = 0;
  let totalBytes = 0;

  const walk = async (real: string, shown: string, depth: number): Promise<FsNode[]> => {
    const children: FsNode[] = [];
    const dirents = (await readdir(real, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const dirent of dirents) {
      const path = `${shown}/${dirent.name}`;
      // Symlinks werden weder verfolgt noch aufgelistet; nur Ordner und reguläre Dateien.
      if (dirent.isSymbolicLink() || !(dirent.isDirectory() || dirent.isFile())) continue;
      if (!isValidName(dirent.name)) {
        skip(shown, 'ungültiger Name');
        continue;
      }
      if (entries >= limits.entries) {
        skip(path, 'zu viele Einträge');
        break;
      }
      const full = join(real, dirent.name);
      const info = await stat(full);
      const mtime = info.mtime.toISOString();

      if (dirent.isDirectory()) {
        entries++;
        children.push({
          type: 'dir',
          name: dirent.name,
          mtime,
          children: depth < limits.depth ? await walk(full, path, depth + 1) : [],
        });
        if (depth >= limits.depth) skip(path, 'zu tief');
        continue;
      }

      if (info.size > limits.fileBytes) {
        skip(path, 'Datei zu groß');
        continue;
      }
      const bytes = await readFile(full);
      const text = asText(bytes);
      if (text !== undefined && totalBytes + bytes.length > limits.totalBytes) {
        skip(path, 'Snapshot zu groß');
        continue;
      }
      entries++;
      if (text === undefined) {
        children.push({ type: 'file', name: dirent.name, mtime, size: bytes.length, binary: true });
      } else {
        totalBytes += bytes.length;
        children.push({ type: 'file', name: dirent.name, mtime, size: bytes.length, text });
      }
    }
    return children;
  };

  const rootNode: FsDir = {
    type: 'dir',
    name: '',
    mtime: rootInfo.mtime.toISOString(),
    children: await walk(root, '', 1),
  };
  const version = createHash('sha256').update(JSON.stringify(rootNode)).digest('hex').slice(0, 16);
  return { version, root: rootNode };
}
