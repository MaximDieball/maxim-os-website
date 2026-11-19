import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@maxim-os/shared';
import { STORAGE_KEY, Workspace, type KeyValueStore } from './workspace.ts';

const T = '2026-01-01T00:00:00.000Z';
const snap = (version = 'v1', text = 'original'): Snapshot => ({
  version,
  root: {
    type: 'dir',
    name: '',
    mtime: T,
    children: [{ type: 'file', name: 'a.txt', mtime: T, size: text.length, text }],
  },
});

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('Workspace', () => {
  it('starts from the snapshot without stored changes', () => {
    const ws = Workspace.open(snap(), memoryStore());
    expect(ws.fs.readText('/a.txt')).toBe('original');
    expect(ws.notice).toBeUndefined();
  });

  it('keeps changes across a reload with the same snapshot version', () => {
    const store = memoryStore();
    const ws = Workspace.open(snap(), store);
    ws.fs.writeText('/b.txt', 'neu');
    expect(ws.save()).toBe(true);
    const again = Workspace.open(snap(), store);
    expect(again.fs.readText('/b.txt')).toBe('neu');
  });

  it('drops stored changes with a notice when the snapshot changed', () => {
    const store = memoryStore();
    const ws = Workspace.open(snap('v1'), store);
    ws.fs.writeText('/b.txt', 'neu');
    ws.save();
    const updated = Workspace.open(snap('v2', 'aktualisiert'), store);
    expect(updated.fs.get('/b.txt')).toBeUndefined();
    expect(updated.fs.readText('/a.txt')).toBe('aktualisiert');
    expect(updated.notice).toContain('zurückgesetzt');
    expect(store.data.has(STORAGE_KEY)).toBe(false);
  });

  it('reset restores the original and clears the storage', () => {
    const store = memoryStore();
    const ws = Workspace.open(snap(), store);
    ws.fs.remove('/a.txt');
    ws.save();
    ws.reset();
    expect(ws.fs.readText('/a.txt')).toBe('original');
    expect(store.data.has(STORAGE_KEY)).toBe(false);
  });

  it('ignores corrupt stored data', () => {
    const store = memoryStore();
    store.setItem(STORAGE_KEY, '{kaputt');
    expect(Workspace.open(snap(), store).fs.readText('/a.txt')).toBe('original');
    store.setItem(STORAGE_KEY, JSON.stringify({ base: 'v1', root: 'x' }));
    expect(Workspace.open(snap(), store).fs.readText('/a.txt')).toBe('original');
  });

  it('works without storage and reports failed saves', () => {
    const ws = Workspace.open(snap(), undefined);
    ws.fs.writeText('/b.txt', 'x');
    expect(ws.save()).toBe(false);
    const full: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(Workspace.open(snap(), full).save()).toBe(false);
  });
});
