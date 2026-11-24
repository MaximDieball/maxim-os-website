import { expect, test, type Page } from '@playwright/test';
import { idle, openTerminal, run, terminalOutput, toBottom, visibleLines } from '../helpers.ts';

// ask (#74) gegen den Stub-Container (#75), nie gegen ein echtes Modell.

/** Sichtbarer Text ohne Leerraum: Umbrüche auf schmalen Screens zählen nicht. */
async function shows(page: Page, text: string, yes = true): Promise<void> {
  const squeeze = (t: string) => t.replace(/\s+/g, '');
  const poll = expect.poll(async () => squeeze(await terminalOutput(page).innerText()));
  if (yes) await poll.toContain(squeeze(text));
  else await poll.not.toContain(squeeze(text));
}
test.describe('ask', () => {
  test('streams the answer from the assistant', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'ask Hallo, wer bist du?');
    await idle(page);
    await shows(page, 'Hallo! Ich bin der Stub-Assistent von MAXIM OS.');
    await shows(page, 'denkt nach', false);
  });

  test('sends the conversation along and forgets it with -n', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'ask Hallo');
    await idle(page);
    // System + Frage, Antwort, Frage
    await run(page, 'ask Wie lang ist der Verlauf?');
    await idle(page);
    await shows(page, 'Nachrichten: 4');
    await run(page, 'ask -n Und jetzt der Verlauf?');
    await idle(page);
    await shows(page, 'Nachrichten: 2');
  });

  test('Ctrl+C stops a running answer', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'ask bitte langsam antworten');
    await shows(page, 'Wort2');
    await page.keyboard.press('Control+C');
    await idle(page);
    await shows(page, '^C');
    await page.waitForTimeout(800);
    await shows(page, 'Wort39', false);
  });

  test('wraps long answers on narrow screens and keeps all words intact', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'ask Erzähl mir was langes');
    await idle(page);
    await toBottom(page);
    await shows(page, 'Alles läuft im Browser.');
    // Kein Wort wird mitten im Wort umgebrochen: jede Zeile endet an einer Wortgrenze
    const lines = await visibleLines(page);
    const answer = lines.slice(
      lines.findIndex((l) => l.startsWith('MAXIM OS ist')),
      -1,
    );
    expect(answer.join(' ').replace(/\s+/g, ' ')).toContain('Dateien anlegen und verschieben');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test('escape sequences from the model cannot control the terminal', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'ask escape bitte');
    await idle(page);
    // \x1b[2J hätte den Bildschirm geleert, \x1b]0; den Titel gesetzt
    await toBottom(page);
    await shows(page, 'Nachher');
    expect(await page.title()).toBe('MAXIM OS');
    await page.mouse.wheel(0, -2000);
    await shows(page, 'an ai coding project');
  });

  test('shows a friendly message when the assistant fails', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'ask das ist kaputt');
    await idle(page);
    await shows(page, 'Der KI-Assistent ist gerade nicht erreichbar.');
    await shows(page, 'internal details', false);
  });
});
