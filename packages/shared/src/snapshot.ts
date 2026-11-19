import { CONTROL_CHARS } from './parse.ts';

/**
 * Snapshot des Content-Ordners (GET /api/fs). Der Server erzeugt ihn einmal beim
 * Start, der Browser baut daraus sein virtuelles Dateisystem (SPEC v4, Abschnitt 2).
 */
export interface FsFile {
  type: 'file';
  name: string;
  /** Letzte Änderung, ISO-8601. */
  mtime: string;
  /** Größe in Bytes. */
  size: number;
  /** Inhalt (nur Textdateien). */
  text?: string;
  /** Binärdatei: wird aufgelistet, aber nicht angezeigt. */
  binary?: true;
}

export interface FsDir {
  type: 'dir';
  name: string;
  mtime: string;
  children: FsNode[];
}

export type FsNode = FsFile | FsDir;

export interface Snapshot {
  /** Hash über den Inhalt. Ändert sich, wenn sich der Content-Ordner ändert. */
  version: string;
  root: FsDir;
}

/** Limits für den Snapshot (Server). */
export const SNAPSHOT_LIMITS = {
  fileBytes: 64 * 1024,
  totalBytes: 2 * 1024 * 1024,
  entries: 2000,
  depth: 12,
} as const;

/** Limits für Namen und Pfade (Server und Browser). */
export const NAME_LIMITS = {
  name: 255,
  path: 1024,
} as const;

/** Gültiger Datei- oder Ordnername: nicht leer, kein "/", "\", keine Steuerzeichen, nicht "." oder "..". */
export function isValidName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= NAME_LIMITS.name &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !CONTROL_CHARS.test(name)
  );
}
