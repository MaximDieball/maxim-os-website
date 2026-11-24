import { describe, expect, it } from 'vitest';
import { QUESTIONS, benchOne, report, summarize, type BenchResult } from './llm-bench.ts';

function sse(parts: string[], timings?: object): Response {
  const lines = parts.map(
    (c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`,
  );
  if (timings) lines.push(`data: ${JSON.stringify({ choices: [{ delta: {} }], timings })}\n\n`);
  lines.push('data: [DONE]\n\n');
  return new Response(lines.join(''), { status: 200 });
}

describe('llm bench', () => {
  it('has ten fixed questions, incl. a prompt injection and an English one', () => {
    expect(QUESTIONS).toHaveLength(10);
    expect(QUESTIONS.some((q) => q.includes('Systemprompt'))).toBe(true);
    expect(QUESTIONS.some((q) => q.startsWith('What'))).toBe(true);
  });

  it('measures time to first token and reads the llama-server timings', async () => {
    let t = 0;
    const sent: unknown[] = [];
    const fake = (async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      t = 120;
      return sse(['Hal', 'lo'], {
        predicted_n: 12,
        predicted_per_second: 21.5,
        prompt_per_second: 300,
      });
    }) as unknown as typeof fetch;
    const r = await benchOne('http://llm:8080', 'System', 'Frage', fake, () => t);
    expect(r).toMatchObject({ answer: 'Hallo', ttftMs: 120, tokens: 12, tokensPerSecond: 21.5 });
    expect(sent[0]).toMatchObject({ stream: true, max_tokens: 384 });
  });

  it('reports failures instead of throwing', async () => {
    const down = (async () => new Response('x', { status: 503 })) as unknown as typeof fetch;
    expect((await benchOne('http://llm', 's', 'q', down)).error).toBe('HTTP 503');
  });

  it('summarizes medians and writes a markdown table', () => {
    const rs: BenchResult[] = [
      { question: 'a', answer: 'x | y', ttftMs: 100, totalMs: 1000, tokensPerSecond: 20 },
      { question: 'b', answer: 'z', ttftMs: 300, totalMs: 3000, tokensPerSecond: 10 },
      { question: 'c', answer: '', ttftMs: 0, totalMs: 5, error: 'HTTP 503' },
    ];
    expect(summarize(rs)).toEqual({
      ok: 2,
      failed: 1,
      medianTtftMs: 200,
      medianTokensPerSecond: 15,
      medianTotalMs: 2000,
    });
    const md = report('Qwen3', 'gpu', rs);
    expect(md).toContain('## Qwen3 (gpu)');
    expect(md).toContain('x \\| y');
    expect(md).toContain('FEHLER: HTTP 503');
  });
});
