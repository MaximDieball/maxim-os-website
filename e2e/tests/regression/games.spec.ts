import { expect, test, type Page } from '@playwright/test';
import { openTerminal, PROMPT_TEXT, run, terminalOutput, visibleLines } from '../helpers.ts';

// Snake (#32) und die Warnung auf Handys (#33).

async function startSnake(page: Page): Promise<void> {
  await openTerminal(page);
  await run(page, 'snake');
  await expect(terminalOutput(page)).toContainText('SNAKE');
}

/** Zurück im normalen Terminal: alte Ausgabe wieder da, Ergebnis, leerer Prompt. */
async function expectBack(page: Page): Promise<void> {
  await expect(terminalOutput(page)).toContainText('an ai coding project');
  await expect(terminalOutput(page)).toContainText('Snake beendet');
  await expect.poll(async () => (await visibleLines(page)).at(-1)).toBe(PROMPT_TEXT);
  await expect(page.locator('#prompt')).toBeVisible();
}

test.describe('snake on desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'Minigames sind mobil nicht unterstützt');

  test('runs on its own screen and ends with Esc', async ({ page }) => {
    await startSnake(page);
    // Während des Spiels ist nur das Spiel zu sehen
    await expect(terminalOutput(page)).not.toContainText('an ai coding project');
    await expect(terminalOutput(page)).toContainText('Score 0');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('d');
    // Tasten landen nicht im Eingabefeld
    await expect(page.locator('#cmd')).toHaveValue('');
    await page.keyboard.press('Escape');
    await expectBack(page);
  });

  test('Ctrl+C ends the game without copying', async ({ page }) => {
    await startSnake(page);
    await page.keyboard.press('Control+C');
    await expectBack(page);
  });

  test('the ✕ in the top left corner ends the game', async ({ page }) => {
    await startSnake(page);
    const box = (await page.locator('.xterm-screen').boundingBox())!;
    await page.mouse.click(box.x + 4, box.y + 6);
    await expectBack(page);
  });
});

test.describe('snake on phones', () => {
  test.skip(({ isMobile }) => !isMobile, 'nur mobil');

  test('warns before starting and cancels by default', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'snake');
    await expect(terminalOutput(page)).toContainText('Snake wird auf Handys nicht unterstützt');
    await expect(terminalOutput(page)).toContainText('(y/N)');
    await page.keyboard.press('Enter');
    await expect(terminalOutput(page)).toContainText('Abgebrochen.');
    await expect(terminalOutput(page)).not.toContainText('SNAKE');
  });

  test('starts anyway after y', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'snake');
    await expect(terminalOutput(page)).toContainText('(y/N)');
    await page.keyboard.type('y');
    await page.keyboard.press('Enter');
    // Kopfzeile mit ✕ bleibt auch auf schmalen Screens sichtbar
    await expect(terminalOutput(page)).toContainText('✕  SNAKE');
    await page.keyboard.press('Escape');
    await expect(terminalOutput(page)).toContainText('Snake beendet');
  });
});
