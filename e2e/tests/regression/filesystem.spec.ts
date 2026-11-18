import { expect, test } from '@playwright/test';
import { openTerminal, run, terminalOutput, visibleLines } from '../helpers.ts';

// Simuliertes Dateisystem gegen das Production-Image mit dem echten content/-Ordner.
test.describe('filesystem', () => {
  test('ls shows the content folder, -a reveals hidden files', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'ls');
    const out = terminalOutput(page);
    await expect(out).toContainText('README.txt');
    await expect(out).toContainText('projects');
    await expect(out).not.toContainText('.easter-egg');
    await run(page, 'ls -a');
    await expect(out).toContainText('.easter-egg');
  });

  test('cd changes the prompt, pwd prints the simulated path', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'cd projects');
    await expect
      .poll(async () => (await visibleLines(page)).at(-1))
      .toBe('guest@maxim-os:/projects$');
    await run(page, 'pwd');
    await expect.poll(async () => (await visibleLines(page)).includes('/projects')).toBe(true);
    await run(page, 'cd ..');
    await expect.poll(async () => (await visibleLines(page)).at(-1)).toBe('guest@maxim-os:/$');
  });

  test('cat prints a text file', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'cat projects/maxim-os.txt');
    await expect(terminalOutput(page)).toContainText('Eine persönliche Website');
  });

  test('tree draws the folder structure', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'tree');
    const out = terminalOutput(page);
    await expect(out).toContainText('ideas.txt');
    await expect(out).toContainText(/\d+ Ordner, \d+ Dateien/);
    await expect(page).toHaveScreenshot('tree.png');
  });

  test('escaping the content folder is refused without leaking host paths', async ({ page }) => {
    await openTerminal(page);
    // Jeden Versuch direkt prüfen (auf kleinen Screens scrollt ältere Ausgabe weg).
    // Umgebrochene Zeilen vor dem Prompt wieder zusammensetzen (xterm.js bricht mitten im Wort um).
    const lastOutput = async () => (await visibleLines(page)).slice(-4, -1).join('');
    for (const attempt of [
      'cat ../../../etc/passwd',
      'cat /etc/passwd',
      'cd /proc/self',
      'cat %2e%2e/%2e%2e/etc/passwd',
    ]) {
      await run(page, attempt);
      await expect.poll(lastOutput, attempt).toContain('Datei oder Ordner nicht gefunden.');
    }
    // ".." endet an der simulierten Wurzel: zeigt den Content-Ordner, nicht das Host-Root.
    await run(page, 'ls ../../..');
    await expect(terminalOutput(page)).toContainText('projects');
    // Nichts vom Host in der gesamten Ausgabe (Live-Region enthält alle Ausgaben).
    const all = page.locator('#live');
    for (const leak of ['root:x:0', '/bin/sh', '/content', '/app', 'node_modules']) {
      await expect(all).not.toContainText(leak);
    }
  });

  test('unknown flags are rejected', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'ls -R');
    await expect(terminalOutput(page)).toContainText('ls: unbekannte Option: -R');
  });

  test('tab completes paths through the server', async ({ page }) => {
    await openTerminal(page);
    await page.locator('#cmd').focus();
    await page.keyboard.type('cat proj');
    await page.keyboard.press('Tab');
    await expect(page.locator('#cmd')).toHaveValue('cat projects/');
    await page.keyboard.type('max');
    await page.keyboard.press('Tab');
    await expect(page.locator('#cmd')).toHaveValue('cat projects/maxim-os.txt ');
  });

  test('wide outputs fit narrow screens without horizontal scrolling', async ({ page }) => {
    await openTerminal(page);
    for (const c of ['ls -la', 'tree', 'help']) await run(page, c);
    await expect(terminalOutput(page)).toContainText('tree -L 2');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
