import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ASK_LIMITS,
  CONTROL_CHARS,
  type AskMessage,
  type AskStatus,
  type ErrorResponse,
} from '@maxim-os/shared';

/**
 * KI-Assistent (#73): POST /api/ask ist der einzige Weg zum Modell. Der Server setzt
 * den festen Systemprompt davor, begrenzt alles (Länge, Tokens, Zeit, Gleichzeitigkeit,
 * Rate-Limit) und streamt die Antwort als gefilterten Text zurück. Das Modell ist ein
 * OpenAI-kompatibler llama-server unter LLM_URL, nur im internen Docker-Netz.
 */

export interface AskOptions {
  /** z. B. http://llm:8080 */
  llmUrl: string;
  apiKey?: string;
  systemPrompt: string;
  fetch?: typeof fetch;
  maxTokens?: number;
  temperature?: number;
  /** Zeit für die ganze Antwort */
  timeoutMs?: number;
  maxRunning?: number;
  maxWaiting?: number;
  rateLimit?: { perClient: number; global: number; windowMs?: number };
  now?: () => number;
  onError?: (error: unknown) => void;
}

const MSG_OFFLINE = 'Der KI-Assistent ist gerade nicht erreichbar.';
const MSG_BUSY = 'Der KI-Assistent ist gerade beschäftigt, versuch es gleich nochmal.';
const MSG_RATE = 'Zu viele Fragen. Bitte kurz warten.';
const MSG_INVALID = 'Ungültige Anfrage.';
/** Obergrenze für eine Antwort in Zeichen, falls das Modell nicht aufhört */
const MAX_ANSWER_CHARS = 6000;
const STATUS_TTL_MS = 15_000;

/** Ohne Steuerzeichen (Zeilenumbrüche bleiben). */
const stripControls = (text: string): string =>
  [...text].filter((c) => c === '\n' || !CONTROL_CHARS.test(c)).join('');

/** Prüft den Body streng; gibt die bereinigten Nachrichten zurück oder undefined. */
export function validateAsk(body: unknown): AskMessage[] | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'messages') return undefined;
  const messages = (body as { messages: unknown }).messages;
  if (!Array.isArray(messages) || messages.length < 1) return undefined;
  if (messages.length > ASK_LIMITS.maxMessages) return undefined;
  const out: AskMessage[] = [];
  for (const m of messages) {
    if (typeof m !== 'object' || m === null || Array.isArray(m)) return undefined;
    const mk = Object.keys(m).sort();
    if (mk.length !== 2 || mk[0] !== 'content' || mk[1] !== 'role') return undefined;
    const { role, content } = m as { role: unknown; content: unknown };
    if (role !== 'user' && role !== 'assistant') return undefined;
    if (typeof content !== 'string') return undefined;
    const max = role === 'user' ? ASK_LIMITS.userChars : ASK_LIMITS.assistantChars;
    if (content.length > max) return undefined;
    const clean = stripControls(content).trim();
    if (!clean) return undefined;
    out.push({ role, content: clean });
  }
  return out.at(-1)!.role === 'user' ? out : undefined;
}

const OPEN = '<think>';
const CLOSE = '</think>';

/** Längstes Ende von `text`, das ein Anfang von `tag` ist (Tag über Chunk-Grenzen). */
function partialTag(text: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (text.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

/**
 * Filter für den Antwort-Stream: entfernt Steuerzeichen (keine Terminal-Injection,
 * Regel 5) und „Denk“-Blöcke `<think>…</think>` mancher Modelle, auch über
 * Chunk-Grenzen hinweg. Leerraum am Anfang der Antwort fällt weg.
 */
export function filterAnswer(): ((chunk: string) => string) & { end(): string } {
  let carry = '';
  let thinking = false;
  let started = false;
  const emit = (text: string): string => {
    let t = stripControls(text);
    if (!started) {
      t = t.replace(/^\s+/, '');
      if (t) started = true;
    }
    return t;
  };
  const f = (chunk: string): string => {
    let text = carry + chunk;
    carry = '';
    let out = '';
    while (text) {
      if (thinking) {
        const i = text.indexOf(CLOSE);
        if (i < 0) {
          carry = text.slice(text.length - partialTag(text, CLOSE));
          return emit(out);
        }
        text = text.slice(i + CLOSE.length);
        thinking = false;
      } else {
        const i = text.indexOf(OPEN);
        if (i < 0) {
          const keep = partialTag(text, OPEN);
          out += text.slice(0, text.length - keep);
          carry = text.slice(text.length - keep);
          return emit(out);
        }
        out += text.slice(0, i);
        text = text.slice(i + OPEN.length);
        thinking = true;
      }
    }
    return emit(out);
  };
  return Object.assign(f, {
    end: () => (thinking ? '' : emit(carry)),
  });
}

/** Warteschlange: höchstens `maxRunning` am Modell, `maxWaiting` warten, sonst „beschäftigt“. */
class Gate {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly maxRunning: number;
  private readonly maxWaiting: number;
  constructor(maxRunning: number, maxWaiting: number) {
    this.maxRunning = maxRunning;
    this.maxWaiting = maxWaiting;
  }

  /** Platz am Modell; `undefined` = beschäftigt; `false` = abgebrochen, während man wartete. */
  async enter(signal: AbortSignal): Promise<boolean | undefined> {
    if (this.running < this.maxRunning) {
      this.running++;
      return true;
    }
    if (this.waiting.length >= this.maxWaiting) return undefined;
    return new Promise<boolean>((resolve) => {
      const go = (): void => {
        signal.removeEventListener('abort', cancel);
        this.running++;
        resolve(true);
      };
      const cancel = (): void => {
        const i = this.waiting.indexOf(go);
        if (i >= 0) this.waiting.splice(i, 1);
        resolve(false);
      };
      signal.addEventListener('abort', cancel, { once: true });
      this.waiting.push(go);
    });
  }

  leave(): void {
    this.running--;
    this.waiting.shift()?.();
  }
}

/** Gleitendes Fenster: pro Client und global. */
class RateLimit {
  private readonly perClient = new Map<string, number[]>();
  private all: number[] = [];
  private readonly limits: { perClient: number; global: number; windowMs?: number };
  private readonly now: () => number;
  constructor(limits: { perClient: number; global: number; windowMs?: number }, now: () => number) {
    this.limits = limits;
    this.now = now;
  }

  allow(client: string): boolean {
    const t = this.now();
    const since = t - (this.limits.windowMs ?? 60_000);
    this.all = this.all.filter((x) => x > since);
    const mine = (this.perClient.get(client) ?? []).filter((x) => x > since);
    if (mine.length >= this.limits.perClient || this.all.length >= this.limits.global) {
      this.perClient.set(client, mine);
      return false;
    }
    mine.push(t);
    this.all.push(t);
    this.perClient.set(client, mine);
    // Speicher begrenzen: alte Clients aufräumen
    if (this.perClient.size > 1000) {
      for (const [k, v] of this.perClient) if (!v.some((x) => x > since)) this.perClient.delete(k);
    }
    return true;
  }
}

/** Liest einen SSE-Stream (`data: {...}`) und liefert die Text-Deltas. */
async function* deltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data) as { choices?: { delta?: { content?: unknown } }[] };
          const content = json.choices?.[0]?.delta?.content;
          if (typeof content === 'string' && content) yield content;
        } catch {
          // kaputte Zeile überspringen
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const sendError = (reply: FastifyReply, status: number, error: string): FastifyReply => {
  const body: ErrorResponse = { error };
  return reply.status(status).header('cache-control', 'no-store').send(body);
};

/** Registriert POST /api/ask und GET /api/ask/status. */
export function createAsk(options: AskOptions): (app: FastifyInstance) => Promise<void> {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const base = options.llmUrl.replace(/\/+$/, '');
  const gate = new Gate(options.maxRunning ?? 1, options.maxWaiting ?? 3);
  const limit = new RateLimit(options.rateLimit ?? { perClient: 10, global: 60 }, now);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
  let status: { at: number; value: AskStatus } | undefined;

  return async (app) => {
    app.post('/api/ask', { bodyLimit: 32 * 1024 }, async (request, reply) => {
      const messages = validateAsk(request.body);
      if (!messages) return sendError(reply, 400, MSG_INVALID);
      if (!limit.allow(request.ip)) return sendError(reply, 429, MSG_RATE);

      // Abbruch: Browser weg oder Zeit abgelaufen -> Anfrage ans Modell abbrechen
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000);
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) controller.abort();
      });
      const done = (): void => clearTimeout(timer);

      const entered = await gate.enter(controller.signal);
      if (entered === undefined) {
        done();
        return sendError(reply, 503, MSG_BUSY);
      }
      if (!entered) {
        done();
        return sendError(reply, 503, MSG_OFFLINE);
      }

      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        done();
        gate.leave();
      };

      let upstream: Response;
      try {
        upstream = await doFetch(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            messages: [{ role: 'system', content: options.systemPrompt }, ...messages],
            stream: true,
            max_tokens: options.maxTokens ?? 384,
            temperature: options.temperature ?? 0.6,
            // Modelle mit „Denkmodus“ (z. B. Qwen3): direkt antworten
            chat_template_kwargs: { enable_thinking: false },
          }),
        });
        if (!upstream.ok || !upstream.body) throw new Error(`llm status ${upstream.status}`);
      } catch (error) {
        release();
        controller.abort();
        options.onError?.(error);
        return sendError(reply, 503, MSG_OFFLINE);
      }

      const filter = filterAnswer();
      const body = upstream.body;
      async function* answer(): AsyncGenerator<string> {
        let total = 0;
        try {
          for await (const delta of deltas(body)) {
            const text = filter(delta);
            if (!text) continue;
            total += text.length;
            yield text;
            if (total >= MAX_ANSWER_CHARS) return;
          }
          const rest = filter.end();
          if (rest) yield rest;
        } catch (error) {
          // Abbruch oder Fehler mitten in der Antwort: einfach beenden
          if (!controller.signal.aborted) options.onError?.(error);
        } finally {
          controller.abort();
          release();
        }
      }

      return reply
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .type('text/plain; charset=utf-8')
        .send(Readable.from(answer()));
    });

    app.get('/api/ask/status', async (_request, reply): Promise<AskStatus> => {
      void reply.header('cache-control', 'no-store');
      if (status && now() - status.at < STATUS_TTL_MS) return status.value;
      let online: boolean;
      try {
        const res = await doFetch(`${base}/health`, {
          headers,
          signal: AbortSignal.timeout(2000),
        });
        online = res.ok;
      } catch {
        online = false;
      }
      status = { at: now(), value: { online } };
      return status.value;
    });
  };
}
