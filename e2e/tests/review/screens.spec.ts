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

test('unknown and many commands', async ({ page }, info) => {
  await openTerminal(page);
  for (const c of ['ls', 'sudo rm -rf /', 'help', 'nope']) await run(page, c);
  await page.screenshot(shot(info.project.name, '03-scrolled'));
});

test('xterm input variant', async ({ page }, info) => {
  await openTerminal(page, 'xterm');
  await run(page, 'help', 'xterm');
  await page.screenshot(shot(info.project.name, '04-xterm-variant'));
});

test.describe('boot animation', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('matrix', async ({ page }, info) => {
    await page.goto('/');
    await page.waitForTimeout(1200);
    await page.screenshot(shot(info.project.name, '00-matrix'));
  });
});
