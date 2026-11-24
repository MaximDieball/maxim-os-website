/**
 * make llm-bench (#71): misst das laufende LLM unter LLM_URL (Standard http://llm:8080)
 * und schreibt den Bericht nach artifacts/llm-bench/. Läuft im tools-Container im llm-net.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { buildSystemPrompt } from '../../apps/server/src/ask-prompt.ts';
import { buildSnapshot } from '../../apps/server/src/snapshot.ts';
import { QUESTIONS, benchOne, report, summarize } from './llm-bench.ts';

const llmUrl = (process.env.LLM_URL ?? 'http://llm:8080').replace(/\/+$/, '');
const variant = process.env.LLM_VARIANT ?? 'cpu';
const root = new URL('../../', import.meta.url).pathname;

const health = await fetch(`${llmUrl}/health`).catch(() => undefined);
if (!health?.ok) {
  console.error(`LLM unter ${llmUrl} nicht erreichbar. Vorher: make llm-model und make llm`);
  process.exit(1);
}
const models = (await (await fetch(`${llmUrl}/v1/models`)).json()) as { data?: { id?: string }[] };
const model = (models.data?.[0]?.id ?? 'unbekannt').split('/').at(-1)!;

// Derselbe Systemprompt wie auf der Website (mit öffentlichen Infos aus content/)
const systemPrompt = buildSystemPrompt(await buildSnapshot(`${root}content`));

console.log(`Benchmark: ${model} (${variant}), ${QUESTIONS.length} Fragen`);
// Einmal aufwärmen (Modell laden), zählt nicht
await benchOne(llmUrl, systemPrompt, 'Hallo');
const results = [];
for (const [i, q] of QUESTIONS.entries()) {
  const r = await benchOne(llmUrl, systemPrompt, q);
  results.push(r);
  console.log(
    `${String(i + 1).padStart(2)}. ${r.error ? `FEHLER ${r.error}` : `${Math.round(r.ttftMs)} ms bis zum ersten Token, ${r.tokensPerSecond?.toFixed(1) ?? '–'} Tokens/s`}`,
  );
}
const s = summarize(results);
console.log(
  `\nMedian: ${Math.round(s.medianTtftMs ?? 0)} ms bis zum ersten Token, ${s.medianTokensPerSecond?.toFixed(1) ?? '–'} Tokens/s`,
);
const dir = `${root}artifacts/llm-bench`;
await mkdir(dir, { recursive: true });
const file = `${dir}/${model}-${variant}.md`;
await writeFile(file, report(model, variant, results));
console.log(`Bericht: artifacts/llm-bench/${model}-${variant}.md`);
