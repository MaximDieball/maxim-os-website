import { expect, test, type Page } from '@playwright/test';
import {
  openTerminal,
  PROMPT_TEXT,
  run,
  terminalOutput,
  terminalText,
  visibleLines,
} from '../helpers.ts';

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

/** Wischgeste über die Terminal-Ausgabe (echte TouchEvents, wie auf dem Handy). */
async function swipe(page: Page, fromY: number, toY: number): Promise<void> {
  await page.evaluate(
    ([from, to]) => {
      const el = document.querySelector('#term')!;
      // WebKit hat keinen Touch-Konstruktor: dort ein Event mit denselben Feldern.
      const native = (() => {
        try {
          new Touch({ identifier: 0, target: el, clientX: 0, clientY: 0 });
          return true;
        } catch {
          return false;
        }
      })();
      const point = (y: number) =>
        native
          ? new Touch({ identifier: 1, target: el, clientX: 120, clientY: y })
          : { identifier: 1, target: el, clientX: 120, clientY: y };
      const fire = (type: string, y: number) => {
        const touches = type === 'touchend' ? [] : [point(y)];
        if (native) {
          el.dispatchEvent(
            new TouchEvent(type, {
              touches: touches as Touch[],
              changedTouches: [point(y) as Touch],
              bubbles: true,
              cancelable: true,
            }),
          );
          return;
        }
        const e = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'touches', { value: touches });
        Object.defineProperty(e, 'changedTouches', { value: [point(y)] });
        el.dispatchEvent(e);
      };
      fire('touchstart', from);
      for (let i = 1; i <= 12; i++) fire('touchmove', from + ((to - from) * i) / 12);
      fire('touchend', to);
    },
    [fromY, toY] as const,
  );
}

test.describe('touch scrolling @input', () => {
  test.beforeEach(({ hasTouch }) => test.skip(!hasTouch, 'nur Touch-Geräte'));

  test('swiping scrolls the output without moving the page', async ({ page }) => {
    await openTerminal(page);
    for (let i = 0; i < 25; i++) await run(page, `cmd${i}`);
    const out = terminalOutput(page);
    await expect(out).toContainText('command not found: cmd24');
    await expect(out).not.toContainText('an ai coding project');

    // Finger nach unten: ältere Ausgabe kommt ins Bild.
    for (let i = 0; i < 4; i++) await swipe(page, 60, 320);
    await expect(out).toContainText('an ai coding project');
    const pageMoved = await page.evaluate(
      () => window.scrollY !== 0 || (window.visualViewport?.offsetTop ?? 0) !== 0,
    );
    expect(pageMoved).toBe(false);

    // Finger nach oben: zurück zum Ende, Prompt wieder unten.
    for (let i = 0; i < 6; i++) await swipe(page, 320, 40);
    await expect.poll(async () => (await visibleLines(page)).at(-1)).toBe(PROMPT_TEXT);
  });

  test('a tap on the output still focuses the input', async ({ page }) => {
    await openTerminal(page);
    await page.locator('#cmd').blur();
    await page.locator('#term').tap({ position: { x: 100, y: 40 } });
    await expect(page.locator('#cmd')).toBeFocused();
  });
});
