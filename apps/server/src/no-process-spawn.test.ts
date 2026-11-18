import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Sicherheitsregel 1: Im Server wird nirgends ein Prozess gestartet.
const FORBIDDEN = [
  /child_process/,
  /node:cluster|['"]cluster['"]/,
  /\bexecSync\b|\bexecFile\b|\bspawnSync\b/,
  /process\.binding/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('server source', () => {
  it('never references process-spawning APIs', () => {
    const files = sourceFiles(join(import.meta.dirname, '.'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) expect(text, file).not.toMatch(pattern);
    }
  });
});
