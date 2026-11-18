import { describe, expect, it } from 'vitest';
import type { DirEntry, TreeNode } from '@maxim-os/shared';
import { formatCat, formatLs, formatSize, formatTree } from './format.ts';
import { stripAnsi } from './text.ts';

const plain = (lines: string[]) => lines.map(stripAnsi);
const entry = (name: string, type: 'dir' | 'file' = 'file', size = 10): DirEntry => ({
  name,
  type,
  size,
  mtime: '2026-11-18T13:05:00.000Z',
});

describe('formatSize', () => {
  it('uses human readable units', () => {
    expect(formatSize(0)).toBe('0');
    expect(formatSize(999)).toBe('999');
    expect(formatSize(2048)).toBe('2.0K');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0M');
  });
});

describe('formatLs', () => {
  const entries = [
    entry('README.txt'),
    entry('docs', 'dir'),
    entry('notes', 'dir'),
    entry('projects', 'dir'),
    entry('a-very-long-file-name.txt'),
  ];

  it('puts short listings into columns that fit the width', () => {
    for (const cols of [100, 44, 30]) {
      const lines = plain(formatLs(entries, false, cols));
      for (const l of lines) expect(l.length, `${cols}: ${l}`).toBeLessThanOrEqual(cols);
      const text = lines.join(' ');
      for (const e of entries) expect(text).toContain(e.name);
    }
    expect(formatLs(entries, false, 100)).toHaveLength(1);
  });

  it('colors directories', () => {
    const line = formatLs([entry('docs', 'dir')], false, 80)[0]!;
    expect(line).toContain('\x1b[');
    expect(stripAnsi(line)).toBe('docs');
  });

  it('prints a long listing with read-only permissions, size and date', () => {
    const lines = plain(formatLs(entries, true, 100));
    expect(lines).toHaveLength(entries.length);
    expect(lines[0]).toMatch(/^-r--r--r-- +10 +\d\d\.\d\d\.2026 \d\d:\d\d +README\.txt$/);
    expect(lines[1]).toMatch(/^dr-xr-xr-x/);
  });

  it('drops the permissions in the narrow long listing', () => {
    const lines = plain(formatLs(entries, true, 40));
    expect(lines[0]).not.toContain('r--');
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(40);
    expect(lines[0]).toContain('README.txt');
  });

  it('says when a directory is empty', () => {
    expect(formatLs([], false, 80)).toEqual([]);
  });
});

describe('formatTree', () => {
  const root: TreeNode = {
    name: '.',
    type: 'dir',
    children: [
      { name: 'docs', type: 'dir', children: [{ name: 'a.txt', type: 'file' }] },
      { name: 'README.txt', type: 'file' },
    ],
  };

  it('draws branches and a summary', () => {
    expect(plain(formatTree(root, 1, 2, false, 80))).toEqual([
      '.',
      '├── docs',
      '│   └── a.txt',
      '└── README.txt',
      '',
      '1 Ordner, 2 Dateien',
    ]);
  });

  it('uses a narrow variant on small screens', () => {
    expect(plain(formatTree(root, 1, 2, false, 40)).slice(0, 4)).toEqual([
      '.',
      '├ docs',
      '│ └ a.txt',
      '└ README.txt',
    ]);
  });

  it('mentions truncation', () => {
    expect(plain(formatTree(root, 1, 2, true, 80)).at(-1)).toContain('gekürzt');
  });
});

describe('formatCat', () => {
  it('splits lines, expands tabs and removes control characters', () => {
    expect(formatCat('a\tb\nc\u001b[31md\u0007\n')).toEqual(['a   b', 'c[31md']);
  });

  it('keeps empty lines but drops the final newline', () => {
    expect(formatCat('a\n\nb\n')).toEqual(['a', '', 'b']);
    expect(formatCat('')).toEqual([]);
  });
});
