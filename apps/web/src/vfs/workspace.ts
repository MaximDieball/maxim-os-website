import type { FsDir, Snapshot } from '@maxim-os/shared';
import { Vfs, type VfsLimits } from './vfs.ts';

/**
 * Arbeitskopie des Users (SPEC v4, Persistenz): virtuelles Dateisystem plus
 * Speichern im localStorage. Gespeichert wird zusammen mit der Snapshot-Version;
 * liefert der Server eine neue Version, wird die alte Kopie verworfen.
 */

/** Teil der Storage-API, den wir brauchen (im Test durch eine Map ersetzt). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEY = 'maxim-os:fs:v1';
export const UPDATED_NOTICE = 'Inhalte wurden aktualisiert, deine Änderungen wurden zurückgesetzt.';

interface Stored {
  base: string;
  root: FsDir;
}

/** localStorage, falls nutzbar (privater Modus, Sperren, volle Quota -> undefined). */
export function browserStorage(): KeyValueStore | undefined {
  try {
    const store = window.localStorage;
    const probe = `${STORAGE_KEY}:probe`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return undefined;
  }
}

function readStored(store: KeyValueStore | undefined): Stored | undefined {
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const data = JSON.parse(raw) as Partial<Stored>;
    if (
      typeof data.base !== 'string' ||
      data.root?.type !== 'dir' ||
      !Array.isArray(data.root.children)
    ) {
      return undefined;
    }
    return data as Stored;
  } catch {
    return undefined;
  }
}

export class Workspace {
  fs: Vfs;
  /** Hinweis für den User nach dem Laden (z. B. Kopie wegen Update verworfen). */
  readonly notice: string | undefined;
  private readonly snapshot: Snapshot;
  private readonly store: KeyValueStore | undefined;
  private readonly limits: Partial<VfsLimits>;

  private constructor(
    snapshot: Snapshot,
    store: KeyValueStore | undefined,
    limits: Partial<VfsLimits>,
    fs: Vfs,
    notice?: string,
  ) {
    this.snapshot = snapshot;
    this.store = store;
    this.limits = limits;
    this.fs = fs;
    this.notice = notice;
  }

  static open(
    snapshot: Snapshot,
    store: KeyValueStore | undefined,
    limits: Partial<VfsLimits> = {},
  ): Workspace {
    const stored = readStored(store);
    if (stored && stored.base === snapshot.version) {
      try {
        return new Workspace(snapshot, store, limits, Vfs.fromSnapshot(stored.root, limits));
      } catch {
        // kaputte Kopie: unten neu anfangen
      }
    }
    let notice: string | undefined;
    if (stored) {
      notice = UPDATED_NOTICE;
      try {
        store?.removeItem(STORAGE_KEY);
      } catch {
        // egal
      }
    }
    return new Workspace(snapshot, store, limits, Vfs.fromSnapshot(snapshot.root, limits), notice);
  }

  /** Speichert die Arbeitskopie. `false`, wenn das nicht ging (kein Speicher, Quota). */
  save(): boolean {
    if (!this.store) return false;
    try {
      const data: Stored = { base: this.snapshot.version, root: this.fs.toSnapshot() };
      this.store.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  /** Verwirft alle Änderungen. */
  reset(): void {
    this.fs = Vfs.fromSnapshot(this.snapshot.root, this.limits);
    try {
      this.store?.removeItem(STORAGE_KEY);
    } catch {
      // egal
    }
  }
}
