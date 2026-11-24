import { expect, test, type Page } from '@playwright/test';
import { openTerminal, run, terminalOutput } from '../helpers.ts';

/**
 * Beim ersten Besuch ist die Bildschirmtastatur noch zu (sie öffnet sich erst beim
 * Antippen). Mobil also mit voller Höhe testen; die Projekte simulieren sonst die offene Tastatur.
 */
async function firstVisit(page: Page, isMobile: boolean): Promise<void> {
  const vp = page.viewportSize()!;
  if (isMobile)
    await page.setViewportSize({ width: vp.width, height: Math.round((vp.width * 16) / 9) });
  await openTerminal(page);
}

// Command-Vorschläge auf dem Startscreen (#99).
test.describe('start suggestions', () => {
  test('are centered at the bottom of the terminal and run their command', async ({
    page,
    isMobile,
  }) => {
    await page.route('https://api.github.com/**', (route) => route.abort());
    await firstVisit(page, isMobile);
    const chips = page.locator('#suggestions');
    await expect(chips).toBeVisible();
    await expect(chips.locator('button')).toHaveText([
      /projects/,
      /watchthis/,
      /snake/,
      /minecraft/,
    ]);

    const box = (await chips.boundingBox())!;
    const term = (await page.locator('#term').boundingBox())!;
    const prompt = (await page.locator('#prompt').boundingBox())!;
    // zentriert, unten im Panel, unter dem Prompt
    expect(Math.abs(box.x + box.width / 2 - (term.x + term.width / 2))).toBeLessThan(3);
    expect(term.y + term.height - (box.y + box.height)).toBeLessThan(40);
    expect(box.y).toBeGreaterThan(prompt.y + prompt.height);
    // nichts ragt aus dem Bild (mobil mit offener Tastatur)
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await expect(page).toHaveScreenshot('start-suggestions.png');

    await chips.getByRole('button', { name: /projects/ }).click();
    await expect(terminalOutput(page)).toContainText('$ projects');
    await expect(terminalOutput(page)).toContainText('maxim-os-website');
    await expect(chips).toBeHidden();
    // Der Fokus bleibt in der Eingabe (Tastatur bleibt offen)
    await expect(page.locator('#cmd')).toBeFocused();
  });

  test('disappear after the first typed command', async ({ page, isMobile }) => {
    await firstVisit(page, isMobile);
    await expect(page.locator('#suggestions')).toBeVisible();
    await run(page, 'pwd');
    await expect(page.locator('#suggestions')).toBeHidden();
  });

  test('never cover the prompt, also with the keyboard open', async ({ page }) => {
    await openTerminal(page);
    const chips = page.locator('#suggestions');
    await page.waitForTimeout(200);
    if (await chips.isVisible()) {
      const box = (await chips.boundingBox())!;
      const prompt = (await page.locator('#prompt').boundingBox())!;
      expect(box.y).toBeGreaterThan(prompt.y + prompt.height);
    }
  });
});
