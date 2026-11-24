// Stub für den KI-Assistenten in UI-Tests (#75): OpenAI-kompatibel wie llama-server,
// aber mit festen Antworten. Läuft nur im Test-Profil, nie in Produktion.
// Gesteuert über Wörter in der letzten Frage:
//   "langsam" -> viele Stücke mit Pause (für Ctrl+C)
//   "lang"    -> lange Antwort (Umbruch auf 360 px)
//   "escape"  -> Antwort mit Escape-Sequenzen (müssen gefiltert werden)
//   "verlauf" -> nennt die Zahl der Nachrichten (Verlauf wird mitgeschickt)
//   "kaputt"  -> Fehler 500
//   "unbekannter command" -> Hilfe mit CMD-Zeile (bei "liste": ls)
//   "minecraft" -> Antwort mit CMD-Zeile (CMD über Chunk-Grenzen verteilt)
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const LONG =
  'MAXIM OS ist eine persönliche Website, die wie ein Terminal aussieht. Du kannst mit Commands wie steckbrief, projects oder snake durch die Seite navigieren, Dateien anlegen und verschieben und sogar Snake spielen. Alles läuft im Browser.';

function answerFor(messages) {
  const q = String(messages.at(-1)?.content ?? '').toLowerCase();
  if (q.includes('kaputt')) return { status: 500 };
  if (q.includes('unbekannter command')) {
    return q.includes('liste')
      ? {
          chunks: [
            'Du meinst wahrscheinlich ls: ',
            'Damit siehst du die Dateien im Ordner. ',
            'Ich habe es dir unten eingefügt.\nCM',
            'D: ls',
          ],
        }
      : { chunks: ['Das gibt es hier nicht. Probier help --short.\n', 'CMD: help --short'] };
  }
  if (q.includes('minecraft')) {
    return {
      chunks: [
        'Mit dem Befehl minecraft siehst du, ',
        'ob mein Server online ist. ',
        'Ich habe ihn dir unten eingefügt.\n',
        'CMD: `minecraft`',
      ],
    };
  }
  if (q.includes('langsam'))
    return { chunks: Array.from({ length: 40 }, (_, i) => `Wort${i} `), delay: 250 };
  if (q.includes('escape'))
    return { chunks: ['Vorher ', '\u001b[2J\u001b]0;pwned\u0007', 'Nachher'] };
  if (q.includes('verlauf')) return { chunks: [`Nachrichten: ${messages.length}`] };
  if (q.includes('lang')) return { chunks: LONG.split(/(?<= )/) };
  return { chunks: ['Hallo! ', 'Ich bin der ', 'Stub-Assistent ', 'von MAXIM OS.'] };
}

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  let raw = '';
  for await (const part of req) raw += part;
  let messages;
  try {
    messages = JSON.parse(raw).messages ?? [];
  } catch {
    res.writeHead(400).end();
    return;
  }
  const answer = answerFor(messages);
  if (answer.status) {
    res.writeHead(answer.status).end('{"error":"stub failure with internal details"}');
    return;
  }
  let closed = false;
  res.on('close', () => (closed = true));
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const content of answer.chunks) {
    if (closed) return;
    if (answer.delay) await sleep(answer.delay);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  }
  res.end('data: [DONE]\n\n');
}).listen(8080, '0.0.0.0');
