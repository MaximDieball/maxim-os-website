import { readdir, realpath, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { CONTROL_CHARS, LIMITS } from '@maxim-os/shared';

/**
 * Sandbox für das simulierte Dateisystem (Sicherheitsregel 4):
 *
 *  1. Eingabe relativ zum aktuellen Verzeichnis zu einem simulierten absoluten
 *     Pfad auflösen ("/" ist der Content-Ordner, ".." endet an der Wurzel).
 *  2. Auf den echten Pfad im Content-Ordner abbilden und mit `fs.realpath`
 *     alle Symlinks auflösen.
 *  3. Gegen die beim Start generierte Allowlist prüfen. Nur dann ist der Pfad gültig.
 *
 * Fehlermeldungen enthalten nie echte Hostpfade und unterscheiden nicht zwischen
 * "existiert nicht" und "verboten".
 */

export const NOT_FOUND = 'Datei oder Ordner nicht gefunden.';
export const INVALID = 'Ungültiger Pfad.';
export const NOT_A_DIR = 'Kein Ordner.';

/** Maximale Länge eines Pfadsegments (wie bei gängigen Dateisystemen). */
const MAX_SEGMENT = 255;
/** Schutz gegen riesige Content-Ordner beim Start. */
const MAX_ENTRIES = 10_000;
const MAX_DEPTH = 16;

/** Menge aller echten Pfade im Content-Ordner. Wird einmal beim Start erzeugt. */
export class Allowlist {
  readonly root: string;
  private readonly set: ReadonlySet<string>;

  constructor(root: string, set: ReadonlySet<string>) {
    this.root = root;
    this.set = set;
  }

  has(realPath: string): boolean {
    return this.set.has(realPath);
  }

  paths(): IterableIterator<string> {
    return this.set.values();
  }

  get size(): number {
    return this.set.size;
  }
}

/**
 * Durchläuft den Content-Ordner und sammelt alle echten Pfade (Ordner und
 * reguläre Dateien). Symlinks werden nicht aufgenommen und nicht verfolgt:
 * erlaubt sind sie nur, wenn ihr Ziel selbst in der Allowlist steht.
 */
export async function buildAllowlist(contentDir: string): Promise<Allowlist> {
  const root = await realpath(contentDir);
  if (!(await stat(root)).isDirectory()) throw new Error('Content-Ordner ist kein Ordner');
  const set = new Set<string>([root]);

  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (set.size >= MAX_ENTRIES) throw new Error('Content-Ordner hat zu viele Einträge');
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        set.add(full);
        if (depth < MAX_DEPTH) await walk(full, depth + 1);
      } else if (entry.isFile()) {
        set.add(full);
      }
    }
  };
  await walk(root, 1);
  return new Allowlist(root, set);
}

export type Resolved =
  | {
      ok: true;
      /** Simulierter Pfad für Ausgaben, z. B. "/docs/a.txt". */
      path: string;
      /** Echter, geprüfter Pfad. Nur serverintern verwenden, nie ausgeben. */
      real: string;
      isDir: boolean;
      size: number;
      mtime: Date;
    }
  | { ok: false; error: string };

function isSafeText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    !CONTROL_CHARS.test(value) &&
    !value.includes('\\')
  );
}

export class Sandbox {
  readonly allowlist: Allowlist;

  constructor(allowlist: Allowlist) {
    this.allowlist = allowlist;
  }

  /** Löst `input` relativ zu `cwd` auf und prüft das Ergebnis gegen die Allowlist. */
  async resolve(cwd: string, input: string): Promise<Resolved> {
    if (!isSafeText(cwd, LIMITS.cwd) || !cwd.startsWith('/')) return { ok: false, error: INVALID };
    if (!isSafeText(input, LIMITS.cwd)) return { ok: false, error: INVALID };

    // "~" ist die simulierte Wurzel.
    const expanded = input === '~' ? '/' : input.startsWith('~/') ? input.slice(1) : input;
    const simulated = posix.resolve('/', cwd, expanded);
    if (simulated.length > LIMITS.cwd) return { ok: false, error: INVALID };
    if (simulated.split('/').some((segment) => segment.length > MAX_SEGMENT)) {
      return { ok: false, error: INVALID };
    }

    const root = this.allowlist.root;
    let real: string;
    try {
      real = await realpath(simulated === '/' ? root : join(root, simulated));
    } catch {
      // ENOENT, ELOOP, ENOTDIR, ENAMETOOLONG ...: alles gleich beantworten.
      return { ok: false, error: NOT_FOUND };
    }
    if (!this.allowlist.has(real)) return { ok: false, error: NOT_FOUND };

    try {
      const info = await stat(real);
      return {
        ok: true,
        path: simulated,
        real,
        isDir: info.isDirectory(),
        size: info.size,
        mtime: info.mtime,
      };
    } catch {
      return { ok: false, error: NOT_FOUND };
    }
  }

  /** Validiert das vom Client geschickte aktuelle Verzeichnis (bei jedem Request). */
  async resolveCwd(
    cwd: string,
  ): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    const r = await this.resolve(cwd, '.');
    if (!r.ok) return r;
    if (!r.isDir) return { ok: false, error: NOT_A_DIR };
    return { ok: true, path: r.path };
  }
}
