import type {
  CommandRequest,
  CommandResult,
  CompleteRequest,
  CompleteResponse,
} from '@maxim-os/shared';

/** Fehler, deren Text direkt im Terminal angezeigt werden darf. */
export class ApiError extends Error {}

/** Schnittstelle zum Server (im Test durch eine Fake-Implementierung ersetzt). */
export interface ServerApi {
  command(req: CommandRequest, signal?: AbortSignal): Promise<CommandResult>;
  complete(req: CompleteRequest, signal?: AbortSignal): Promise<string[]>;
}

const TIMEOUT_MS = 8000;

/** Kombiniert Abbruch durch den Nutzer (Ctrl+C) mit einem Timeout. */
function withTimeout(signal: AbortSignal | undefined): {
  signal: AbortSignal;
  timedOut: () => boolean;
  done: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const t = withTimeout(signal);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: t.signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error; // Ctrl+C: Aufrufer bricht still ab
      throw new ApiError(t.timedOut() ? 'Zeitüberschreitung.' : 'Server nicht erreichbar.');
    }
    if (res.status === 429) throw new ApiError('Zu viele Anfragen. Bitte kurz warten.');
    if (!res.ok) throw new ApiError('Anfrage abgelehnt.');
    return (await res.json()) as T;
  } finally {
    t.done();
  }
}

export function createServerApi(base = ''): ServerApi {
  return {
    command: (req, signal) => post<CommandResult>(`${base}/api/command`, req, signal),
    complete: async (req, signal) =>
      (await post<CompleteResponse>(`${base}/api/complete`, req, signal)).candidates,
  };
}
