import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Test-Dateisystem (nur für Tests):
 *
 *   <base>/secret/passwd.txt          außerhalb, darf nie lesbar sein
 *   <base>/content/README.txt
 *   <base>/content/.hidden
 *   <base>/content/docs/a.txt
 *   <base>/content/docs/deep/b.txt
 *   <base>/content/ümlaut.txt
 *   <base>/content/binary.bin         enthält Null-Bytes
 *   <base>/content/link-inside   ->   docs/a.txt          (erlaubt)
 *   <base>/content/link-dir      ->   docs                (erlaubt)
 *   <base>/content/link-out      ->   ../secret/passwd.txt (verboten)
 *   <base>/content/link-out-dir  ->   ../secret            (verboten)
 *   <base>/content/chain1 -> chain2 -> docs/a.txt          (erlaubt)
 *   <base>/content/chain-out1 -> chain-out2 -> ../secret   (verboten)
 *   <base>/content/loop1 <-> loop2                         (Schleife)
 *   <base>/content/abs-out      ->   <base>/secret (absolut, verboten)
 */
export interface Fixture {
  base: string;
  content: string;
  secret: string;
  cleanup(): void;
}

export function createFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), 'maxim-fs-'));
  const content = join(base, 'content');
  const secret = join(base, 'secret');
  mkdirSync(secret);
  writeFileSync(join(secret, 'passwd.txt'), 'TOP SECRET');
  mkdirSync(join(content, 'docs', 'deep'), { recursive: true });
  writeFileSync(join(content, 'README.txt'), 'Willkommen\n');
  writeFileSync(join(content, '.hidden'), 'versteckt\n');
  writeFileSync(join(content, 'docs', 'a.txt'), 'A\n');
  writeFileSync(join(content, 'docs', 'deep', 'b.txt'), 'B\n');
  writeFileSync(join(content, 'ümlaut.txt'), 'Ü\n');
  writeFileSync(join(content, 'binary.bin'), Buffer.from([0x50, 0x4b, 0x00, 0x01, 0x02]));
  symlinkSync('docs/a.txt', join(content, 'link-inside'));
  symlinkSync('docs', join(content, 'link-dir'));
  symlinkSync('../secret/passwd.txt', join(content, 'link-out'));
  symlinkSync('../secret', join(content, 'link-out-dir'));
  symlinkSync('chain2', join(content, 'chain1'));
  symlinkSync('docs/a.txt', join(content, 'chain2'));
  symlinkSync('chain-out2', join(content, 'chain-out1'));
  symlinkSync('../secret', join(content, 'chain-out2'));
  symlinkSync('loop2', join(content, 'loop1'));
  symlinkSync('loop1', join(content, 'loop2'));
  symlinkSync(secret, join(content, 'abs-out'));
  return { base, content, secret, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}
