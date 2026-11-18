import { expect, test } from '@playwright/test';
import { openTerminal, PROMPT_TEXT, run, terminalOutput, visibleLines } from '../helpers.ts';

test.describe('terminal', () => {
  test('startscreen', async ({ page }) => {
    await openTerminal(page);
    const out = terminalOutput(page);
    await expect(out).toContainText('an ai coding project');
    await expect(out).toContainText("'help'");
    await expect(page).toHaveScreenshot('startscreen.png');
  });

  test('help lists the registry', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'help');
    const out = terminalOutput(page);
    await expect(out).toContainText('Verfügbare Commands');
    await expect(out).toContainText('clear');
    await expect(page).toHaveScreenshot('help.png');
  });

  test('prompt and typed text sit inline right after the output', async ({ page }) => {
    await openTerminal(page);
    await page.locator('#cmd').focus();
    await page.keyboard.type('hel');
    await expect.poll(async () => (await visibleLines(page)).at(-1)).toBe(`${PROMPT_TEXT} hel`);
    // Kein Feld am unteren Rand: das Input liegt auf der Prompt-Zeile direkt unter dem Hinweis.
    const lines = await visibleLines(page);
    expect(lines.at(-2)).toContain('kennenzulernen');
    const input = (await page.locator('#cmd').boundingBox())!;
    const row = (await page
      .locator('.xterm-rows > div')
      .filter({ hasText: `${PROMPT_TEXT} hel` })
      .boundingBox())!;
    expect(Math.abs(input.y - row.y)).toBeLessThanOrEqual(4);
    await expect(page).toHaveScreenshot('typing.png');
  });

  test('long input wraps and editing keeps the line intact', async ({ page }) => {
    await openTerminal(page);
    await page.locator('#cmd').focus();
    await page.keyboard.type('x'.repeat(70));
    await page.keyboard.press('Home');
    await page.keyboard.type('ab');
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    const expected = `ab${'x'.repeat(69)}`;
    await expect(page.locator('#cmd')).toHaveValue(expected);
    await expect
      .poll(async () => (await visibleLines(page)).join('').replace(/\s/g, ''))
      .toContain(`${PROMPT_TEXT}${expected}`.replace(/\s/g, ''));
    await page.keyboard.press('Enter');
    await expect(terminalOutput(page)).toContainText('command not found: abxxx');
  });

  test('submitted commands stay visible behind their prompt', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'sudo');
    await expect(terminalOutput(page)).toContainText(`${PROMPT_TEXT} sudo`);
    await expect.poll(async () => (await visibleLines(page)).at(-1)).toBe(PROMPT_TEXT);
  });

  test('unknown command', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'sudo');
    await expect(terminalOutput(page)).toContainText("command not found: sudo. Tippe 'help'.");
  });

  test('clear and ctrl+l empty the screen', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'clear');
    await expect(terminalOutput(page)).not.toContainText('an ai coding project');
    await run(page, 'help');
    await expect(terminalOutput(page)).toContainText('Verfügbare Commands');
    await page.keyboard.press('Control+l');
    await expect(terminalOutput(page)).not.toContainText('Verfügbare Commands');
  });

  test('history with arrow keys', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'help');
    await run(page, 'clear');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#cmd')).toHaveValue('help');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#cmd')).toHaveValue('clear');
  });

  test('tab completes commands', async ({ page }) => {
    await openTerminal(page);
    await page.locator('#cmd').focus();
    await page.keyboard.type('he');
    await page.keyboard.press('Tab');
    await expect(page.locator('#cmd')).toHaveValue('help ');
  });

  test('screen reader live region gets the output', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'help');
    await expect(page.locator('#live')).toContainText('Verfügbare Commands');
  });

  test('input has mobile-safe attributes', async ({ page }) => {
    await openTerminal(page);
    const input = page.locator('#cmd');
    for (const [name, value] of [
      ['autocapitalize', 'off'],
      ['autocorrect', 'off'],
      ['autocomplete', 'off'],
      ['spellcheck', 'false'],
      ['enterkeyhint', 'send'],
    ]) {
      await expect(input).toHaveAttribute(name!, value!);
    }
    const fontSize = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
  });
});

test.describe('mobile with open keyboard', () => {
  test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'nur mobil'));

  test('input line and quick keys stay inside the visible area', async ({ page }) => {
    await openTerminal(page);
    const vh = page.viewportSize()!.height;
    for (const sel of ['#cmd', '#quickkeys']) {
      const box = (await page.locator(sel).boundingBox())!;
      expect(box.y + box.height, sel).toBeLessThanOrEqual(vh);
      await expect(page.locator(sel)).toBeVisible();
    }
  });

  test('no horizontal scrolling', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'help');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('output auto-scrolls and focus stays after enter', async ({ page }) => {
    await openTerminal(page);
    for (let i = 0; i < 12; i++) await run(page, `cmd${i}`);
    await expect.poll(async () => (await visibleLines(page)).at(-1)).toBe(PROMPT_TEXT);
    await expect
      .poll(async () => (await visibleLines(page)).at(-2))
      .toContain("command not found: cmd11. Tippe 'help'.");
    await expect(page.locator('#cmd')).toBeFocused();
  });

  test('quick keys work without stealing focus', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'help');
    await page.locator('#quickkeys [data-key="up"]').tap();
    await expect(page.locator('#cmd')).toHaveValue('help');
    await expect(page.locator('#cmd')).toBeFocused();
    await page.locator('#quickkeys [data-key="ctrlc"]').tap();
    await expect(page.locator('#cmd')).toHaveValue('');
    await page.locator('#quickkeys [data-insert="/"]').tap();
    await expect(page.locator('#cmd')).toHaveValue('/');
    await expect(page.locator('#cmd')).toBeFocused();
  });

  test('tapping the output focuses the input', async ({ page }) => {
    await openTerminal(page);
    await page.locator('#cmd').blur();
    await page.locator('#term').tap();
    await expect(page.locator('#cmd')).toBeFocused();
  });
});

test.describe('boot animation', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('reveals the start screen that is already rendered underneath', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#matrix')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await expect(terminalOutput(page)).toContainText('an ai coding project');
    // Animation läuft noch, während der Startscreen schon da ist.
    await expect(page.locator('html')).not.toHaveAttribute('data-booted', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-booted', 'true', { timeout: 6000 });
    await expect(page.locator('#matrix')).toBeHidden();
  });

  test('a key press skips the animation', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-booted', 'true', { timeout: 1000 });
  });
});
