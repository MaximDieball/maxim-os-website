import { test } from '@playwright/test';
import { openTerminal, run } from '../helpers.ts';

// Entwickler-Screenshots (nicht in der Pipeline): artifacts/screenshots/<projekt>/<name>.png
const shot = (project: string, name: string) => ({
  path: `artifacts/screenshots/${project}/${name}.png`,
});

test('startscreen', async ({ page }, info) => {
  await openTerminal(page);
  await page.screenshot(shot(info.project.name, '01-startscreen'));
});

test('help', async ({ page }, info) => {
  await openTerminal(page);
  await run(page, 'help');
  await page.screenshot(shot(info.project.name, '02-help'));
});

test('typing', async ({ page }, info) => {
  await openTerminal(page);
  await run(page, 'help');
  await page.locator('#cmd').focus();
  await page.keyboard.type('cle');
  await page.screenshot(shot(info.project.name, '04-typing'));
});

test('unknown and many commands', async ({ page }, info) => {
  await openTerminal(page);
  for (const c of ['ls', 'sudo rm -rf /', 'help', 'nope']) await run(page, c);
  await page.screenshot(shot(info.project.name, '03-scrolled'));
});

test.describe('boot animation', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('matrix reveal', async ({ page }, info) => {
    await page.goto('/');
    // Verdeckt, halb freigegeben, fast frei (Abstände zwischen den Aufnahmen).
    for (const [wait, name] of [
      [300, '00-matrix-a'],
      [1000, '00-matrix-b'],
      [900, '00-matrix-c'],
    ] as const) {
      await page.waitForTimeout(wait);
      await page.screenshot(shot(info.project.name, name));
    }
  });
});
