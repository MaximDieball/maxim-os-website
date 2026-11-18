import { expect, test } from '@playwright/test';
import { openTerminal, run, terminalOutput, terminalText } from '../helpers.ts';

// Mobile Eingabe (Ergebnis des Spikes #15): natives <input>, auf Chromium (Android) und WebKit (iOS).
test.describe('mobile input @input', () => {
  test('typing and enter run a command', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'help');
    await expect(terminalOutput(page)).toContainText('Verfügbare Commands');
  });

  test('history recall via quick key', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Quick-Keys nur mobil');
    await openTerminal(page);
    await run(page, 'sudo');
    await expect(terminalOutput(page)).toContainText('command not found: sudo');
    await page.locator('#quickkeys [data-key="up"]').tap();
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await terminalText(page)).match(/command not found: sudo/g)?.length)
      .toBe(2);
  });

  test('control characters are not echoed', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'abc\u0007def');
    await expect(terminalOutput(page)).toContainText('command not found: abcdef');
  });
});
