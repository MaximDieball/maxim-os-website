// Lädt ein Modell aus models.tsv nach /models und prüft die SHA-256-Prüfsumme (#72).
// Aufruf über `make llm-model MODEL=<id>`; läuft in einem eigenen Container, nur er hat Internet.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { readFile, rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const id = process.argv[2];
if (!id) {
  console.error('Modell-ID fehlt (siehe docker/llm/models.tsv)');
  process.exit(1);
}
const rows = (await readFile('/llm/models.tsv', 'utf8'))
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => l.split('\t'));
const row = rows.find((r) => r[0] === id);
if (!row) {
  console.error(`Unbekanntes Modell: ${id}. Vorhanden: ${rows.map((r) => r[0]).join(', ')}`);
  process.exit(1);
}
const [, file, url, sha, size] = row;
const target = `/models/${file}`;

async function hashOf(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

if (existsSync(target) && (await hashOf(target)) === sha) {
  console.log(`${file} ist schon da und geprüft.`);
  process.exit(0);
}

console.log(`Lade ${file} (${size}) ...`);
const res = await fetch(url, { redirect: 'follow' });
if (!res.ok || !res.body) {
  console.error(`Download fehlgeschlagen: HTTP ${res.status}`);
  process.exit(1);
}
const total = Number(res.headers.get('content-length')) || 0;
let done = 0;
let lastPct = -1;
const hash = createHash('sha256');
const progress = new Transform({
  transform(chunk, _enc, cb) {
    hash.update(chunk);
    done += chunk.length;
    const pct = total ? Math.floor((done / total) * 100) : -1;
    if (pct >= 0 && pct % 10 === 0 && pct !== lastPct) {
      lastPct = pct;
      console.log(`  ${pct} %`);
    }
    cb(null, chunk);
  },
});
await pipeline(Readable.fromWeb(res.body), progress, createWriteStream(`${target}.part`));
if (hash.digest('hex') !== sha) {
  await rm(`${target}.part`, { force: true });
  console.error('Prüfsumme stimmt nicht, Datei verworfen.');
  process.exit(1);
}
await rename(`${target}.part`, target);
console.log(`${file} geladen und geprüft.`);
