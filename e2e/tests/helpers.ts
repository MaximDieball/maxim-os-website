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
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

/** Nicht-leere Zeilen im sichtbaren Terminalbereich (ohne Leerzeilen). */
export async function visibleLines(page: Page): Promise<string[]> {
  const rows = await page.locator('.xterm-rows > div').allInnerTexts();
  return rows.map((r) => r.replace(/\u00a0/g, ' ').trimEnd()).filter(Boolean);
}

export const PROMPT_TEXT = 'guest@maxim-os:/$';

/** Ende der help-Ausgabe (letzter Registry-Eintrag), breit als Tabelle oder schmal gestapelt. */
export const HELP_END = /Beispiel: +reset|reset {2,}reset/;
