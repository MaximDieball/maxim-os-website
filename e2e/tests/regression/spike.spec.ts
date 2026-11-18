import { expect, test } from '@playwright/test';
import { openTerminal, run, terminalOutput, terminalText, type InputMode } from '../helpers.ts';

// Eingabe-Spike: beide Varianten auf Chromium (Android) und WebKit (iOS).
for (const mode of ['native', 'xterm'] as InputMode[]) {
  test.describe(`input spike: ${mode} @spike`, () => {
    test('typing and enter run a command', async ({ page }) => {
      await openTerminal(page, mode);
      await run(page, 'help', mode);
      await expect(terminalOutput(page)).toContainText('Verfügbare Commands');
    });

    test('history recall via quick key', async ({ page, isMobile }) => {
      test.skip(!isMobile, 'Quick-Keys nur mobil');
      await openTerminal(page, mode);
      await run(page, 'sudo', mode);
      await expect(terminalOutput(page)).toContainText('command not found: sudo');
      await page.locator('#quickkeys [data-key="up"]').tap();
      await page.keyboard.press('Enter');
      await expect
        .poll(async () => (await terminalText(page)).match(/command not found: sudo/g)?.length)
        .toBe(2);
    });

    test('control characters are not echoed', async ({ page }) => {
      await openTerminal(page, mode);
      await run(page, 'abc\u0007def', mode);
      await expect(terminalOutput(page)).toContainText('command not found: abcdef');
    });
  });
}
