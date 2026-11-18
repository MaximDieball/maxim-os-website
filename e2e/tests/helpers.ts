import { expect, type Locator, type Page } from '@playwright/test';

export type InputMode = 'native' | 'xterm';

export async function openTerminal(page: Page, mode: InputMode = 'native'): Promise<void> {
  const query = new URLSearchParams({ boot: 'skip' });
  if (mode === 'xterm') query.set('input', 'xterm');
  await page.goto(`/?${query}`);
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
export async function run(page: Page, command: string, mode: InputMode = 'native'): Promise<void> {
  if (mode === 'native') await page.locator('#cmd').focus();
  else await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}

/** Letzte nicht-leere Zeile im sichtbaren Terminalbereich. */
export async function lastVisibleLine(page: Page): Promise<string> {
  const rows = await page.locator('.xterm-rows > div').allInnerTexts();
  return (
    rows
      .map((r) => r.replace(/\u00a0/g, ' ').trimEnd())
      .filter(Boolean)
      .at(-1) ?? ''
  );
}
