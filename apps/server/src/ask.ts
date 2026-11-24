import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ASK_COMMAND_SEPARATOR,
  ASK_LIMITS,
  CONTROL_CHARS,
  findCommand,
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

/**
 * Steuer-Token von Chat-Vorlagen (z. B. `<|im_start|>`, `<start_of_turn>`): Damit kann
 * niemand eigene Rollen (system) in den Verlauf schmuggeln (#76).
 */
const TEMPLATE_TOKENS =
  /<\|[^|<>\s]{1,40}\|>|<\/?(start_of_turn|end_of_turn|bos|eos|s)>|\[\/?INST\]/gi;

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
    const clean = stripControls(content).replace(TEMPLATE_TOKENS, ' ').trim();
    if (!clean) return undefined;
    out.push({ role, content: clean });
  }
  // Gesamtbudget: lange Verläufe würden den einzigen Slot lange blockieren
  if (out.reduce((n, m) => n + m.content.length, 0) > ASK_LIMITS.totalChars) return undefined;
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

/**
 * Prüft einen vom Modell vorgeschlagenen Command (#108): nur registrierte Commands,
 * ohne Steuerzeichen, kurz. Auch verändernde Commands sind erlaubt (Entscheidung des
 * Besitzers); eingefügt wird nur in die Eingabe, ausgeführt erst mit Enter.
 */
export function validCommand(raw: string): string | undefined {
  const command = stripControls(raw)
    .replace(/[`"„“]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!command || command.length > 120) return undefined;
  return findCommand(command.split(' ')[0]!) ? command : undefined;
}

const CMD_LINE = /^\s*(cmd|befehl)\s*:/i;
const CMD_STARTS = ['cmd:', 'befehl:'];

/**
 * Nimmt eine Zeile `CMD: <command>` aus der Antwort (#108). Normale Zeilen werden
 * sofort weitergegeben; nur der Anfang einer Zeile, der noch `CMD:` werden könnte,
 * wird kurz zurückgehalten. Der erste gültige Command gewinnt.
 */
export function commandExtractor(): {
  push(text: string): string;
  end(): { text: string; command?: string };
} {
  let line = '';
  let mode: 'unknown' | 'plain' | 'cmd' = 'unknown';
  let command: string | undefined;
  const couldBeCmd = (s: string): boolean => {
    const t = s.replace(/\s+/g, '').toLowerCase();
    return CMD_STARTS.some((p) => p.startsWith(t));
  };
  const finish = (): string => {
    let out = '';
    if (mode === 'cmd') command ??= validCommand(line.replace(CMD_LINE, ''));
    else if (mode === 'unknown') out = line;
    line = '';
    mode = 'unknown';
    return out;
  };
  return {
    push(text) {
      let out = '';
      for (const c of text) {
        if (c === '\n') {
          const wasCmd = mode === 'cmd';
          out += finish();
          if (!wasCmd) out += '\n';
          continue;
        }
        line += c;
        if (mode === 'plain') out += c;
        else if (mode === 'unknown') {
          if (CMD_LINE.test(line)) mode = 'cmd';
          else if (!couldBeCmd(line)) {
            mode = 'plain';
            out += line;
          }
        }
      }
      return out;
    },
    end() {
      const text = finish();
      return { text, command };
    },
  };
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

/**
 * Gleitendes Fenster: pro Client und global. Achtung: Hinter einem Tunnel ohne echte
 * Client-IP haben alle Besucher dieselbe Adresse, dann wirkt `perClient` global (#76, M1).
 */
export class RateLimit {
  private readonly perClient = new Map<string, number[]>();
  private all: number[] = [];
  private readonly limits: { perClient: number; global: number; windowMs?: number };
  private readonly now: () => number;
  constructor(limits: { perClient: number; global: number; windowMs?: number }, now: () => number) {
    this.limits = limits;
    this.now = now;
  }

  /** Anzahl gemerkter Clients (für Tests). */
  get size(): number {
    return this.perClient.size;
  }

  allow(client: string): boolean {
    const t = this.now();
    const since = t - (this.limits.windowMs ?? 60_000);
    this.all = this.all.filter((x) => x > since);
    const mine = (this.perClient.get(client) ?? []).filter((x) => x > since);
    if (mine.length >= this.limits.perClient || this.all.length >= this.limits.global) {
      // Abgelehnte ohne Einträge nicht speichern (sonst wächst die Map, #76)
      if (mine.length) this.perClient.set(client, mine);
      else this.perClient.delete(client);
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

/**
 * Antwort-Stream, der den Platz in der Warteschlange in jedem Fall wieder freigibt,
 * auch wenn er zerstört wird, bevor der Generator anläuft (#76, L1).
 */
export function streamWithRelease(source: AsyncGenerator<string>, release: () => void): Readable {
  const stream = Readable.from(source);
  stream.once('close', release);
  return stream;
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
    // Zusätzlich das globale Limit für /api/* (#76, L2)
    app.post(
      '/api/ask',
      { bodyLimit: 32 * 1024, config: { rateLimit: {} } },
      async (request, reply) => {
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
        const commands = commandExtractor();
        const body = upstream.body;
        async function* answer(): AsyncGenerator<string> {
          let total = 0;
          try {
            for await (const delta of deltas(body)) {
              const text = commands.push(filter(delta));
              if (!text) continue;
              total += text.length;
              yield text;
              if (total >= MAX_ANSWER_CHARS) return;
            }
            const rest = commands.push(filter.end());
            const last = commands.end();
            if (rest + last.text) yield rest + last.text;
            // Vorgeschlagener Command nach einem Trennzeichen, das das Modell nicht erzeugen kann
            if (last.command) {
              yield ASK_COMMAND_SEPARATOR + JSON.stringify({ command: last.command });
            }
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
          .send(streamWithRelease(answer(), release));
      },
    );

    app.get(
      '/api/ask/status',
      { config: { rateLimit: {} } },
      async (_request, reply): Promise<AskStatus> => {
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
      },
    );
  };
}
