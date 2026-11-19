import { describe, expect, it } from 'vitest';
import type { FsDir } from '@maxim-os/shared';
import { Vfs, VfsError } from './vfs.ts';

const T = '2026-01-01T00:00:00.000Z';
const snapshot = (): FsDir => ({
  type: 'dir',
  name: '',
  mtime: T,
  children: [
    { type: 'file', name: 'README.txt', mtime: T, size: 6, text: 'hallo\n' },
    { type: 'file', name: '.hidden', mtime: T, size: 1, text: 'x' },
    { type: 'file', name: 'bild.png', mtime: T, size: 100, binary: true },
    {
      type: 'dir',
      name: 'docs',
      mtime: T,
      children: [
        { type: 'file', name: 'a.txt', mtime: T, size: 2, text: 'A\n' },
        { type: 'dir', name: 'deep', mtime: T, children: [] },
      ],
    },
  ],
});
const fresh = (limits = {}) => Vfs.fromSnapshot(snapshot(), limits);

/** Erwartet einen VfsError mit dieser Meldung. */
function throwsMsg(fn: () => unknown, message: string | RegExp): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(VfsError);
    expect((e as Error).message).toMatch(message);
    return;
  }
  throw new Error('erwartet VfsError');
}

describe('resolve', () => {
  const fs = fresh();
  it('normalizes relative and absolute paths', () => {
    expect(fs.resolve('/', '')).toBe('/');
    expect(fs.resolve('/', '.')).toBe('/');
    expect(fs.resolve('/', 'docs')).toBe('/docs');
    expect(fs.resolve('/docs', 'deep/../a.txt')).toBe('/docs/a.txt');
    expect(fs.resolve('/docs', '/README.txt')).toBe('/README.txt');
    expect(fs.resolve('/', 'docs//deep/./')).toBe('/docs/deep');
  });

  it('stops .. at the root and maps ~ to the root', () => {
    expect(fs.resolve('/', '../../..')).toBe('/');
    expect(fs.resolve('/docs', '~')).toBe('/');
    expect(fs.resolve('/docs', '~/README.txt')).toBe('/README.txt');
  });

  it('rejects invalid names and overlong paths', () => {
    throwsMsg(() => fs.resolve('/', 'a\u0000b'), 'Ungültiger Name');
    throwsMsg(() => fs.resolve('/', 'a\\b'), 'Ungültiger Name');
    throwsMsg(() => fs.resolve('/', 'x'.repeat(256)), 'Ungültiger Name');
    throwsMsg(() => fs.resolve('/', 'a/'.repeat(600)), 'Pfad zu lang');
  });
});

describe('reading', () => {
  it('finds nodes and lists children sorted', () => {
    const fs = fresh();
    expect(fs.get('/docs')?.type).toBe('dir');
    expect(fs.get('/nope')).toBeUndefined();
    expect(fs.list('/').map((n) => n.name)).toEqual(['.hidden', 'README.txt', 'bild.png', 'docs']);
    throwsMsg(() => fs.list('/README.txt'), 'Kein Ordner');
    throwsMsg(() => fs.list('/nope'), 'nicht gefunden');
  });

  it('reads text and refuses directories and binaries', () => {
    const fs = fresh();
    expect(fs.readText('/docs/a.txt')).toBe('A\n');
    throwsMsg(() => fs.readText('/docs'), 'Ist ein Ordner');
    throwsMsg(() => fs.readText('/bild.png'), 'Binärdatei');
    throwsMsg(() => fs.readText('/missing.txt'), 'nicht gefunden');
  });

  it('does not treat path segments through files as directories', () => {
    throwsMsg(() => fresh().list('/README.txt/x'), /nicht gefunden|Kein Ordner/);
  });
});

describe('mkdir', () => {
  it('creates directories, with -p also parents', () => {
    const fs = fresh();
    fs.mkdir('/neu');
    expect(fs.get('/neu')?.type).toBe('dir');
    throwsMsg(() => fs.mkdir('/a/b/c'), 'nicht gefunden');
    fs.mkdir('/a/b/c', { parents: true });
    expect(fs.get('/a/b/c')?.type).toBe('dir');
    fs.mkdir('/a/b', { parents: true }); // existiert: mit -p kein Fehler
  });

  it('refuses existing names, parents that are files and the root', () => {
    const fs = fresh();
    throwsMsg(() => fs.mkdir('/docs'), 'Existiert bereits');
    throwsMsg(() => fs.mkdir('/README.txt/x'), 'Kein Ordner');
    throwsMsg(() => fs.mkdir('/README.txt', { parents: true }), 'Existiert bereits');
    throwsMsg(() => fs.mkdir('/'), 'Existiert bereits');
  });
});

describe('writing files', () => {
  it('creates, overwrites and appends text', () => {
    const fs = fresh();
    fs.writeText('/notiz.txt', 'eins\n');
    fs.writeText('/notiz.txt', 'zwei\n', { append: true });
    expect(fs.readText('/notiz.txt')).toBe('eins\nzwei\n');
    fs.writeText('/notiz.txt', 'neu\n');
    expect(fs.readText('/notiz.txt')).toBe('neu\n');
    expect(fs.get('/notiz.txt')).toMatchObject({ size: 4 });
  });

  it('refuses writing into directories or missing parents', () => {
    const fs = fresh();
    throwsMsg(() => fs.writeText('/docs', 'x'), 'Ist ein Ordner');
    throwsMsg(() => fs.writeText('/nope/x.txt', 'x'), 'nicht gefunden');
    throwsMsg(() => fs.writeText('/', 'x'), 'Ist ein Ordner');
  });

  it('overwriting a binary file turns it into a text file', () => {
    const fs = fresh();
    fs.writeText('/bild.png', 'jetzt Text');
    expect(fs.readText('/bild.png')).toBe('jetzt Text');
  });

  it('touch creates empty files and updates timestamps', () => {
    const fs = fresh();
    fs.touch('/leer.txt');
    expect(fs.readText('/leer.txt')).toBe('');
    const before = fs.get('/docs')!.mtime;
    fs.touch('/docs');
    expect(fs.get('/docs')!.mtime).toBeGreaterThanOrEqual(before);
    expect(fs.get('/docs')?.type).toBe('dir');
  });
});

describe('remove', () => {
  it('removes files, and directories only recursively', () => {
    const fs = fresh();
    fs.remove('/README.txt');
    expect(fs.get('/README.txt')).toBeUndefined();
    throwsMsg(() => fs.remove('/docs'), 'Ist ein Ordner');
    fs.remove('/docs', { recursive: true });
    expect(fs.get('/docs')).toBeUndefined();
  });

  it('reports missing paths unless forced and never removes the root', () => {
    const fs = fresh();
    throwsMsg(() => fs.remove('/nope'), 'nicht gefunden');
    fs.remove('/nope', { force: true });
    throwsMsg(() => fs.remove('/', { recursive: true, force: true }), 'Wurzel');
  });

  it('rmdir only removes empty directories', () => {
    const fs = fresh();
    fs.rmdir('/docs/deep');
    expect(fs.get('/docs/deep')).toBeUndefined();
    throwsMsg(() => fs.rmdir('/docs'), 'nicht leer');
    throwsMsg(() => fs.rmdir('/README.txt'), 'Kein Ordner');
  });
});

describe('move', () => {
  it('renames files and directories', () => {
    const fs = fresh();
    fs.move('/README.txt', '/LIESMICH.txt');
    expect(fs.readText('/LIESMICH.txt')).toBe('hallo\n');
    expect(fs.get('/README.txt')).toBeUndefined();
    fs.move('/docs', '/dokumente');
    expect(fs.readText('/dokumente/a.txt')).toBe('A\n');
  });

  it('moves into an existing directory and overwrites files', () => {
    const fs = fresh();
    fs.move('/README.txt', '/docs');
    expect(fs.get('/docs/README.txt')?.type).toBe('file');
    fs.writeText('/x.txt', 'x');
    fs.move('/x.txt', '/docs/a.txt');
    expect(fs.readText('/docs/a.txt')).toBe('x');
  });

  it('refuses moving a directory into itself, onto a file, or the root', () => {
    const fs = fresh();
    throwsMsg(() => fs.move('/docs', '/docs/deep'), 'in der Quelle');
    throwsMsg(() => fs.move('/docs', '/docs'), 'in der Quelle');
    throwsMsg(() => fs.move('/docs', '/README.txt'), 'Kein Ordner');
    throwsMsg(() => fs.move('/', '/x'), 'Wurzel');
    throwsMsg(() => fs.move('/nope', '/x'), 'nicht gefunden');
    throwsMsg(() => fs.move('/README.txt', '/nope/x'), 'nicht gefunden');
  });

  it('moving a file onto itself changes nothing', () => {
    const fs = fresh();
    fs.move('/README.txt', '/README.txt');
    expect(fs.readText('/README.txt')).toBe('hallo\n');
  });
});

describe('copy', () => {
  it('copies files and, with recursive, directories deeply', () => {
    const fs = fresh();
    fs.copy('/README.txt', '/kopie.txt');
    fs.writeText('/kopie.txt', 'geändert');
    expect(fs.readText('/README.txt')).toBe('hallo\n');
    throwsMsg(() => fs.copy('/docs', '/docs2'), 'Ist ein Ordner');
    fs.copy('/docs', '/docs2', { recursive: true });
    fs.writeText('/docs2/a.txt', 'B');
    expect(fs.readText('/docs/a.txt')).toBe('A\n');
    expect(fs.get('/docs2/deep')?.type).toBe('dir');
  });

  it('copies into an existing directory and never into itself', () => {
    const fs = fresh();
    fs.copy('/README.txt', '/docs');
    expect(fs.readText('/docs/README.txt')).toBe('hallo\n');
    throwsMsg(() => fs.copy('/docs', '/docs/deep', { recursive: true }), 'in der Quelle');
  });
});

describe('limits', () => {
  it('limits file size', () => {
    const fs = fresh({ fileBytes: 10 });
    throwsMsg(() => fs.writeText('/x.txt', 'x'.repeat(11)), 'Datei zu groß');
    fs.writeText('/x.txt', 'x'.repeat(5));
    throwsMsg(() => fs.writeText('/x.txt', 'x'.repeat(6), { append: true }), 'Datei zu groß');
  });

  it('limits total size but always allows freeing space', () => {
    const fs = fresh({ totalBytes: 20 });
    fs.writeText('/x.txt', 'x'.repeat(5));
    throwsMsg(() => fs.writeText('/y.txt', 'y'.repeat(10)), 'Kein Platz');
    fs.remove('/x.txt'); // Löschen geht immer und schafft wieder Platz
    fs.copy('/README.txt', '/r2.txt');
    expect(fs.readText('/r2.txt')).toBe('hallo\n');
  });

  it('limits the number of entries', () => {
    const fs = fresh({ entries: 7 });
    fs.mkdir('/a');
    throwsMsg(() => fs.mkdir('/b'), 'Zu viele Einträge');
    throwsMsg(() => fs.copy('/docs', '/docs2', { recursive: true }), 'Zu viele Einträge');
  });

  it('counts unicode text in UTF-8 bytes', () => {
    const fs = fresh();
    fs.writeText('/u.txt', 'ü');
    expect(fs.get('/u.txt')).toMatchObject({ size: 2 });
  });
});

describe('snapshot round trip', () => {
  it('serializes back to the snapshot format', () => {
    const fs = fresh();
    fs.writeText('/neu.txt', 'n');
    const out = fs.toSnapshot();
    const again = Vfs.fromSnapshot(out);
    expect(again.readText('/neu.txt')).toBe('n');
    expect(again.get('/bild.png')).toMatchObject({ type: 'file', binary: true });
    expect(again.list('/docs').map((n) => n.name)).toEqual(['a.txt', 'deep']);
  });

  it('skips invalid names from a snapshot', () => {
    const bad = snapshot();
    bad.children.push({ type: 'file', name: 'a/b', mtime: T, size: 0, text: '' });
    bad.children.push({ type: 'file', name: '..', mtime: T, size: 0, text: '' });
    expect(
      Vfs.fromSnapshot(bad)
        .list('/')
        .map((n) => n.name),
    ).not.toContain('a/b');
  });
});
