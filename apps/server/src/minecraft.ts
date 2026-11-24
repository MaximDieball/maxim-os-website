import type { MinecraftStatus } from '@maxim-os/shared';
import { CONTROL_CHARS } from '@maxim-os/shared';

/**
 * Status des Minecraft-Servers (#35). Der Browser kann das Minecraft-Protokoll nicht
 * selbst sprechen, deshalb fragt der Server per Server-List-Ping. Er nimmt keine
 * Parameter vom User: Host und Port kommen aus der Umgebung. Antworten werden einige
 * Sekunden gecacht, gleichzeitige Anfragen teilen sich einen Ping.
 */

/** Rohdaten eines Pings (Ausschnitt aus minecraft-server-util). */
export interface RawStatus {
  version?: { name?: unknown };
  players?: { online?: unknown; max?: unknown; sample?: unknown };
  motd?: { clean?: unknown };
  roundTripLatency?: unknown;
}

export type Pinger = (host: string, port: number, timeoutMs: number) => Promise<RawStatus>;

export interface MinecraftOptions {
  host: string;
  port: number;
  ping: Pinger;
  /** Cache-Dauer in ms */
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
}

const MAX_NAMES = 12;

/** Ohne Steuerzeichen und §-Farbcodes, Leerraum zusammengefasst, gekürzt. */
function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    .replace(/§./g, '')
    .split('')
    .filter((c) => !CONTROL_CHARS.test(c) || c === '\n')
    .join('')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, max);
  return text || undefined;
}

const count = (v: unknown): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? Math.min(v, 1_000_000) : 0;

/** Spielernamen nach Minecraft-Regeln (3–16 Zeichen, a–z, 0–9, _); alles andere fällt weg. */
function names(sample: unknown): string[] {
  if (!Array.isArray(sample)) return [];
  return sample
    .map((p) => (typeof p === 'object' && p !== null ? (p as { name?: unknown }).name : undefined))
    .filter((n): n is string => typeof n === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(n))
    .slice(0, MAX_NAMES);
}

export function toStatus(address: string, raw: RawStatus): MinecraftStatus {
  const latency = raw.roundTripLatency;
  return {
    online: true,
    address,
    version: clean(raw.version?.name, 60),
    motd: clean(raw.motd?.clean, 200),
    players: {
      online: count(raw.players?.online),
      max: count(raw.players?.max),
      names: names(raw.players?.sample),
    },
    latencyMs:
      typeof latency === 'number' && Number.isFinite(latency) && latency >= 0
        ? Math.round(latency)
        : undefined,
  };
}

/** Liefert eine Funktion, die den (gecachten) Status holt. Fehler gelten als offline. */
export function createMinecraftStatus(options: MinecraftOptions): () => Promise<MinecraftStatus> {
  const ttl = options.ttlMs ?? 10_000;
  const timeout = options.timeoutMs ?? 3000;
  const now = options.now ?? Date.now;
  const address = options.port === 25565 ? options.host : `${options.host}:${options.port}`;
  let cached: { at: number; status: MinecraftStatus } | undefined;
  let inflight: Promise<MinecraftStatus> | undefined;

  const fetchStatus = async (): Promise<MinecraftStatus> => {
    try {
      // Eigenes Zeitlimit zusätzlich zum Timeout der Bibliothek
      const raw = await Promise.race([
        options.ping(options.host, options.port, timeout),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('minecraft ping timeout')), timeout + 500).unref?.(),
        ),
      ]);
      return toStatus(address, raw);
    } catch (error) {
      options.onError?.(error);
      return { online: false, address };
    }
  };

  return async () => {
    if (cached && now() - cached.at < ttl) return cached.status;
    inflight ??= fetchStatus().then((status) => {
      cached = { at: now(), status };
      inflight = undefined;
      return status;
    });
    return inflight;
  };
}
