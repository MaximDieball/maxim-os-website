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

test('filesystem', async ({ page }, info) => {
  await openTerminal(page);
  await run(page, 'ls -la');
  await run(page, 'cd projects');
  await run(page, 'tree /');
  await page.waitForTimeout(300);
  await page.screenshot(shot(info.project.name, '05-filesystem'));
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

test('project page with download link', async ({ page }, info) => {
  // Ohne GitHub: Fallback-Daten aus content/about/steckbrief.json
  await page.route('https://api.github.com/**', (route) => route.abort());
  await openTerminal(page);
  await run(page, 'projects');
  await run(page, 'project Paper-Memes');
  await page.waitForTimeout(300);
  await page.screenshot(shot(info.project.name, '06-project'));
});

test('snake', async ({ page }, info) => {
  await openTerminal(page);
  await run(page, 'snake');
  if (info.project.name !== 'desktop') {
    await page.keyboard.type('y');
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(800);
  await page.screenshot(shot(info.project.name, '07-snake'));
  await page.keyboard.press('Escape');
});
