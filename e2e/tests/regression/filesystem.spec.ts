import { expect, test, type Page } from '@playwright/test';
import { HELP_END, openTerminal, run, terminalOutput, visibleLines, toBottom } from '../helpers.ts';

// Dateisystem im Browser (Snapshot aus dem Production-Image mit dem echten content/-Ordner).
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
    // auf kleinen Screens bleibt die Ansicht oben stehen (#101)
    await toBottom(page);
    const out = terminalOutput(page);
    await expect(out).toContainText('ideas.txt');
    await expect(out).toContainText(/\d+ Ordner, \d+ Dateien/);
    await expect(page).toHaveScreenshot('tree.png');
  });

  test('escaping the content folder is refused without leaking host paths', async ({ page }) => {
    await openTerminal(page);
    // Jeden Versuch direkt prüfen (auf kleinen Screens scrollt ältere Ausgabe weg).
    // Umgebrochene Zeilen vor dem Prompt wieder zusammensetzen (xterm.js bricht mitten im Wort um).
    // Leerzeichen am Zeilenende gehen beim Umbruch verloren: ohne Leerzeichen vergleichen.
    const lastOutput = async () =>
      (await visibleLines(page)).slice(-4, -1).join('').replace(/\s+/g, '');
    for (const attempt of [
      'cat ../../../etc/passwd',
      'cat /etc/passwd',
      'cd /proc/self',
      'cat %2e%2e/%2e%2e/etc/passwd',
    ]) {
      await run(page, attempt);
      await expect.poll(lastOutput, attempt).toContain('DateioderOrdnernichtgefunden');
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

  test('tab completes paths locally', async ({ page }) => {
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
    await toBottom(page);
    await expect(terminalOutput(page)).toContainText(HELP_END);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('editing the local copy', () => {
  /** Letzte Ausgabezeilen vor dem Prompt, umgebrochene Zeilen zusammengesetzt. */
  const lastOutput = async (page: Page) => (await visibleLines(page)).slice(-3, -1).join('');

  test('create, write, read, move and delete files', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'mkdir -p notizen/2026');
    await run(page, 'echo hallo welt > notizen/2026/gruss.txt');
    await run(page, 'echo zweite zeile >> notizen/2026/gruss.txt');
    await run(page, 'cat notizen/2026/gruss.txt');
    await expect(terminalOutput(page)).toContainText('zweite zeile');
    await run(page, 'mv notizen/2026/gruss.txt notizen/hallo.txt');
    await run(page, 'rm -r notizen/2026');
    await run(page, 'ls notizen');
    await expect.poll(async () => (await visibleLines(page)).at(-2)).toBe('hallo.txt');
    await run(page, 'rm notizen');
    await expect
      .poll(() => lastOutput(page))
      .toContain('rm: notizen: Ist ein Ordner (rm -r verwenden)');
  });

  test('changes survive a reload and reset restores the original', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'rm README.txt');
    await run(page, 'touch neu.txt');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await run(page, 'ls');
    await expect.poll(() => lastOutput(page)).toContain('neu.txt');
    await expect.poll(() => lastOutput(page)).not.toContain('README.txt');

    await run(page, 'reset');
    await expect
      .poll(async () => (await visibleLines(page)).at(-1))
      .toBe('Änderungen verwerfen? (y/N)');
    await run(page, 'y');
    await expect(terminalOutput(page)).toContainText('Originalzustand wiederhergestellt.');
    await run(page, 'ls');
    await expect.poll(() => lastOutput(page)).toContain('README.txt');
    await expect.poll(() => lastOutput(page)).not.toContain('neu.txt');
  });

  test('redirects command output into a file', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'ls > liste.txt');
    await run(page, 'cat liste.txt');
    await expect(terminalOutput(page)).toContainText('projects');
    await run(page, 'cd projects > x.txt');
    await expect.poll(() => lastOutput(page)).toContain('cd: Ausgabe kann nicht umgeleitet werden');
  });

  test('the server only serves the snapshot', async ({ page }) => {
    const fs = await page.request.get('/api/fs');
    expect(fs.status()).toBe(200);
    expect(fs.headers()['etag']).toBeTruthy();
    const body = await fs.text();
    expect(body).not.toContain('/content');
    for (const url of ['/api/command', '/api/complete']) {
      const res = await page.request.post(url, { data: { cwd: '/', name: 'ls', args: [] } });
      expect(res.status(), url).toBe(404);
    }
  });
});
