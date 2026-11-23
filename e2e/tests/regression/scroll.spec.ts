import { expect, test } from '@playwright/test';
import { idle, openTerminal, PROMPT_TEXT, run, visibleLines } from '../helpers.ts';

// Lange Ausgaben bleiben am Anfang stehen, Pfeil nach unten (#101).
test.describe('long output and the scroll-down arrow', () => {
  test('keeps the command at the top and shows the arrow', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'help');
    await idle(page);
    const arrow = page.locator('#scroll-down');
    await expect(arrow).toBeVisible();
    // Die Command-Zeile steht oben, das Ende (Prompt) ist noch nicht zu sehen
    await expect.poll(async () => (await visibleLines(page))[0]).toBe(`${PROMPT_TEXT} help`);
    expect((await visibleLines(page)).at(-1)).not.toBe(PROMPT_TEXT);
    // unten in der Mitte des Panels
    const box = (await arrow.boundingBox())!;
    const term = (await page.locator('#term').boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - (term.x + term.width / 2))).toBeLessThan(3);
    expect(term.y + term.height - (box.y + box.height)).toBeLessThan(30);
    await expect(page).toHaveScreenshot('scroll-arrow.png');

    // force: der Pfeil schwebt (Animation)
    await arrow.click({ force: true });
    await expect(arrow).toBeHidden();
    await expect.poll(async () => (await visibleLines(page)).at(-1)).toBe(PROMPT_TEXT);
    await expect(page.locator('#cmd')).toBeFocused();
  });

  test('typing jumps to the prompt', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'help');
    await idle(page);
    await expect(page.locator('#scroll-down')).toBeVisible();
    await page.keyboard.type('l');
    await expect(page.locator('#scroll-down')).toBeHidden();
    await expect.poll(async () => (await visibleLines(page)).at(-1)).toBe(`${PROMPT_TEXT} l`);
  });

  test('short output stays at the bottom without arrow', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'pwd');
    await idle(page);
    await expect.poll(async () => (await visibleLines(page)).at(-1)).toBe(PROMPT_TEXT);
    await expect(page.locator('#scroll-down')).toBeHidden();
  });

  test('the arrow also appears after scrolling up by hand', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Mausrad nur auf dem Desktop');
    await openTerminal(page);
    await run(page, 'help');
    await idle(page);
    await page.locator('#scroll-down').click({ force: true });
    await expect(page.locator('#scroll-down')).toBeHidden();
    const term = (await page.locator('.xterm-screen').boundingBox())!;
    await page.mouse.move(term.x + term.width / 2, term.y + term.height / 2);
    await page.mouse.wheel(0, -200);
    await expect(page.locator('#scroll-down')).toBeVisible();
  });
});
