import { expect, type Locator, type Page } from '@playwright/test';

export async function openTerminal(page: Page): Promise<void> {
  await page.goto('/?boot=skip');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Ausgabe des Terminals (xterm.js DOM-Renderer). xterm.js rendert asynchron,
 * deshalb immer mit wiederholenden Assertions prüfen (toContainText, expect.poll).
 */
export function terminalOutput(page: Page): Locator {
  return page.locator('.xterm-rows');
}

/** Sichtbarer Text des Terminals (Momentaufnahme, nur mit expect.poll verwenden). */
export async function terminalText(page: Page): Promise<string> {
  return terminalOutput(page).innerText();
}

/** Tippt einen Command und schickt ihn mit Enter ab. */
export async function run(page: Page, command: string): Promise<void> {
  await page.locator('#cmd').focus();
  // Vorschläge des Assistenten (#108) stehen evtl. schon in der Eingabe
  await page.locator('#cmd').fill('');
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

/** Wartet, bis kein Command mehr läuft und alles gezeichnet ist (data-busy, #101). */
export async function idle(page: Page): Promise<void> {
  await expect(page.locator('html')).not.toHaveAttribute('data-busy', 'true');
}

/** Scrollt per Pfeil ganz nach unten, falls die Ansicht oben stehen geblieben ist. */
export async function toBottom(page: Page): Promise<void> {
  await idle(page);
  const arrow = page.locator('#scroll-down');
  // force: der Pfeil schwebt (Animation), Playwright würde sonst auf Stillstand warten
  if (await arrow.isVisible()) await arrow.click({ force: true, timeout: 1000 }).catch(() => {});
  await expect(arrow).toBeHidden();
}

/** Nicht-leere Zeilen im sichtbaren Terminalbereich (ohne Leerzeilen). */
export async function visibleLines(page: Page): Promise<string[]> {
  const rows = await page.locator('.xterm-rows > div').allInnerTexts();
  return rows.map((r) => r.replace(/\u00a0/g, ' ').trimEnd()).filter(Boolean);
}

export const PROMPT_TEXT = 'guest@maxim-os:/$';

/** Ende der help-Ausgabe (letzter Registry-Eintrag), breit als Tabelle oder schmal gestapelt. */
export const HELP_END = /Beispiel: +history|history {2,}history/;

/**
 * Klickt auf einen Text in der Ausgabe. Textzeilen haben pointer-events: none, also per
 * Position: der letzte Abschnitt (span) mit diesem Text, kurz hinter seinem Anfang.
 */
export async function clickText(page: Page, text: string): Promise<void> {
  // Erst klicken, wenn alles gezeichnet ist; dann vom Ende aus suchen.
  await toBottom(page);
  await expect.poll(async () => (await visibleLines(page)).at(-1)).toBe(PROMPT_TEXT);
  const span = page.locator('.xterm-rows span').filter({ hasText: text }).last();
  // Kleine Bildschirme: xterm zeigt nur sichtbare Zeilen, also ggf. hochscrollen.
  const screen = (await page.locator('.xterm-screen').boundingBox())!;
  const wheel = async (dy: number): Promise<void> => {
    await page.mouse.move(screen.x + screen.width / 2, screen.y + screen.height / 2);
    await page.mouse.wheel(0, dy);
  };
  let scrolled = 0;
  let box: { x: number; y: number; width: number; height: number } | null = null;
  // xterm zeichnet Zeilen neu: Position erneut lesen, bis sie stabil vorliegt.
  for (let i = 0; i < 20 && !box; i++) {
    box = await span.boundingBox({ timeout: 300 }).catch(() => null);
    if (!box && scrolled < 10 && !(await span.isVisible())) {
      await wheel(-60);
      scrolled++;
    }
  }
  if (!box) throw new Error(`Text nicht gefunden: ${text}`);
  await page.mouse.click(box.x + Math.min(20, box.width / 2), box.y + box.height / 2);
  // Zurück zum Prompt wie ein Nutzer: Tippen scrollt ans Ende (ein Link gibt keine Ausgabe).
  if (scrolled) {
    await page.keyboard.type('x');
    await page.keyboard.press('Backspace');
  }
}
