import { describe, expect, it } from 'vitest';
import { isValidName } from './snapshot.ts';

describe('isValidName', () => {
  it('accepts normal and unicode names', () => {
    for (const n of ['README.txt', '.hidden', 'ümlaut.txt', 'a b', 'x'.repeat(255)]) {
      expect(isValidName(n), n).toBe(true);
    }
  });

  it('rejects empty, dot names, separators, control characters and long names', () => {
    for (const n of [
      '',
      '.',
      '..',
      'a/b',
      'a\\b',
      'a\u0000b',
      'a\u001b[31m',
      'x‮',
      'x'.repeat(256),
    ]) {
      expect(isValidName(n), JSON.stringify(n)).toBe(false);
    }
  });
});
