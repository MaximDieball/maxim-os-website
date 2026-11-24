import type { AskMessage, ErrorResponse } from '@maxim-os/shared';

/**
 * Client für POST /api/ask (#74). Die Antwort kommt als Text-Stream; `onText` bekommt
 * jedes Stück. Fehler des Servers sind JSON mit einer fertigen, freundlichen Meldung.
 */
export const MSG_OFFLINE = 'Der KI-Assistent ist gerade nicht erreichbar.';

export type AskResult = { ok: true; text: string } | { ok: false; error: string };

export async function askStream(
  messages: AskMessage[],
  onText: (text: string) => void,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<AskResult> {
  const doFetch = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: options.signal,
    });
  } catch {
    return { ok: false, error: MSG_OFFLINE };
  }
  if (!res.ok || !res.body) {
    let error = MSG_OFFLINE;
    try {
      const body = (await res.json()) as Partial<ErrorResponse>;
      // Nur kurze Texte übernehmen; gefiltert wird ohnehin bei der Ausgabe
      if (typeof body.error === 'string' && body.error.length <= 200) error = body.error;
    } catch {
      // generische Meldung
    }
    return { ok: false, error };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;
      text += chunk;
      onText(chunk);
    }
  } catch {
    // Abbruch (Ctrl+C) oder Verbindung weg: bisherigen Text behalten
  }
  return { ok: true, text };
}
