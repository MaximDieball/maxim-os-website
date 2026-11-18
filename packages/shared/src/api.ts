/** API-Typen und Schemas zwischen Client und Server. */
import { z } from 'zod';
import { LIMITS } from './parse.ts';

export interface HealthResponse {
  status: 'ok';
}

export interface ErrorResponse {
  error: string;
}

/** Simulierter absoluter Pfad, z. B. "/" oder "/projects". */
const simulatedPath = z.string().min(1).max(LIMITS.cwd).startsWith('/');

/** POST /api/command */
export const CommandRequestSchema = z
  .object({
    cwd: simulatedPath,
    name: z.string().min(1).max(LIMITS.name),
    args: z.array(z.string().max(LIMITS.token)).max(LIMITS.tokens - 1),
  })
  .strict();
export type CommandRequest = z.infer<typeof CommandRequestSchema>;

/** POST /api/complete: Pfad-Vervollständigung. */
export const CompleteRequestSchema = z
  .object({
    cwd: simulatedPath,
    partial: z.string().max(LIMITS.token),
  })
  .strict();
export type CompleteRequest = z.infer<typeof CompleteRequestSchema>;

export type EntryType = 'dir' | 'file';

export interface DirEntry {
  name: string;
  type: EntryType;
  /** Größe in Bytes (Dateien). */
  size: number;
  /** Letzte Änderung, ISO-8601. */
  mtime: string;
}

export interface TreeNode {
  name: string;
  type: EntryType;
  children?: TreeNode[];
}

/** Ergebnis eines serverseitigen Commands. Formatiert wird im Client. */
export type CommandResult =
  | { kind: 'ls'; path: string; long: boolean; entries: DirEntry[] }
  | { kind: 'cd'; cwd: string }
  | { kind: 'pwd'; cwd: string }
  | { kind: 'cat'; path: string; text: string }
  | { kind: 'tree'; path: string; root: TreeNode; dirs: number; files: number; truncated: boolean }
  | { kind: 'error'; message: string };

export interface CompleteResponse {
  /** Vollständige Kandidaten (inkl. Ordnerpfad aus `partial`), Ordner enden auf "/". */
  candidates: string[];
}
