import type { Snapshot } from '@maxim-os/shared';
import { browserStorage, Workspace } from './workspace.ts';

const TIMEOUT_MS = 8000;

/**
 * Lädt den Snapshot vom Server (GET /api/fs) und öffnet die Arbeitskopie.
 * Gibt undefined zurück, wenn das nicht klappt; die Shell funktioniert dann ohne
 * Dateisystem weiter.
 */
export async function loadWorkspace(url = '/api/fs'): Promise<Workspace | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // no-cache: der Browser fragt mit ETag nach und bekommt bei gleicher Version 304.
    const res = await fetch(url, { cache: 'no-cache', signal: controller.signal });
    if (!res.ok) return undefined;
    const snapshot = (await res.json()) as Snapshot;
    if (typeof snapshot?.version !== 'string' || snapshot.root?.type !== 'dir') return undefined;
    return Workspace.open(snapshot, browserStorage());
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
