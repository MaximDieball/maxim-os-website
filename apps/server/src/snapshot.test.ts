import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FsDir, FsNode, Snapshot } from '@maxim-os/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture, type Fixture } from './test.fixture.ts';
import { buildSnapshot } from './snapshot.ts';

let fx: Fixture;
let snap: Snapshot;

const child = (dir: FsDir, name: string): FsNode | undefined =>
  dir.children.find((c) => c.name === name);
const names = (dir: FsDir): string[] => dir.children.map((c) => c.name);

beforeAll(async () => {
  fx = createFixture();
  // Zusätzliche Fälle für den Generator
  writeFileSync(join(fx.content, 'esc\u001b[31mname.txt'), 'x');
  writeFileSync(join(fx.content, 'back\\slash.txt'), 'x');
  writeFileSync(join(fx.content, 'invalid-utf8.txt'), Buffer.from([0x61, 0xff, 0xfe, 0x62]));
  snap = await buildSnapshot(fx.content);
});
afterAll(() => fx.cleanup());

describe('buildSnapshot', () => {
  it('contains directories and text files with content', () => {
    expect(snap.root.type).toBe('dir');
    expect(names(snap.root)).toEqual(
      expect.arrayContaining(['README.txt', 'docs', '.hidden', 'ümlaut.txt']),
    );
    expect(child(snap.root, 'README.txt')).toMatchObject({
      type: 'file',
      text: 'Willkommen\n',
      size: 11,
    });
    const docs = child(snap.root, 'docs') as FsDir;
    expect(names(docs)).toEqual(['a.txt', 'deep']);
    expect(child(child(docs, 'deep') as FsDir, 'b.txt')).toMatchObject({ text: 'B\n' });
  });

  it('sorts children by name', () => {
    expect(names(snap.root)).toEqual([...names(snap.root)].sort());
  });

  it('never follows or lists symlinks', () => {
    for (const link of [
      'link-inside',
      'link-dir',
      'link-out',
      'link-out-dir',
      'chain1',
      'chain-out1',
      'loop1',
      'abs-out',
    ]) {
      expect(names(snap.root)).not.toContain(link);
    }
    const json = JSON.stringify(snap);
    expect(json).not.toContain('TOP SECRET');
    expect(json).not.toContain('passwd');
  });

  it('marks binary files and omits their content', () => {
    for (const name of ['binary.bin', 'invalid-utf8.txt']) {
      const file = child(snap.root, name);
      expect(file, name).toMatchObject({ type: 'file', binary: true });
      expect(file && 'text' in file && file.text).toBeFalsy();
    }
  });

  it('keeps raw text (the client sanitizes the output)', () => {
    expect(child(snap.root, 'ansi.txt')).toMatchObject({ type: 'file' });
  });

  it('skips entries with invalid names', () => {
    expect(names(snap.root).some((n) => n.includes('\u001b'))).toBe(false);
    expect(names(snap.root)).not.toContain('back\\slash.txt');
  });

  it('leaves out files above the size limit', () => {
    expect(names(snap.root)).not.toContain('big.txt');
  });

  it('contains no host paths', () => {
    const json = JSON.stringify(snap);
    expect(json).not.toContain(fx.base);
    expect(json).not.toContain(fx.content);
  });

  it('has a stable version that changes with the content', async () => {
    expect(snap.version).toMatch(/^[0-9a-f]{16}$/);
    expect((await buildSnapshot(fx.content)).version).toBe(snap.version);
    writeFileSync(join(fx.content, 'new.txt'), 'neu');
    expect((await buildSnapshot(fx.content)).version).not.toBe(snap.version);
  });

  it('enforces entry, depth and total size limits', async () => {
    const dir = join(fx.base, 'limits');
    mkdirSync(join(dir, 'a', 'b', 'c', 'd'), { recursive: true });
    writeFileSync(join(dir, 'a', 'b', 'c', 'd', 'deep.txt'), 'tief');
    for (let i = 0; i < 20; i++)
      writeFileSync(join(dir, `f${String(i).padStart(2, '0')}.txt`), 'x'.repeat(100));

    const shallow = await buildSnapshot(dir, { depth: 2 });
    const a = child(shallow.root, 'a') as FsDir;
    expect(child(a, 'b')).toMatchObject({ type: 'dir', children: [] });

    const few = await buildSnapshot(dir, { entries: 5 });
    const count = (d: FsDir): number =>
      d.children.reduce((n, c) => n + 1 + (c.type === 'dir' ? count(c) : 0), 0);
    expect(count(few.root)).toBeLessThanOrEqual(5);

    const small = await buildSnapshot(dir, { totalBytes: 450 });
    const bytes = JSON.stringify(small.root).match(/x{100}/g)?.length ?? 0;
    expect(bytes).toBeLessThanOrEqual(4);
  });

  it('fails for a missing content directory', async () => {
    await expect(buildSnapshot(join(fx.base, 'nope'))).rejects.toThrow();
  });
});
