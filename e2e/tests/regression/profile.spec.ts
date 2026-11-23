import { expect, test, type Page } from '@playwright/test';
import { openTerminal, run, terminalOutput, visibleLines } from '../helpers.ts';

// Steckbrief und Projekte (#29, #31). GitHub wird nie wirklich angefragt.
const PROFILE = {
  login: 'MaximDieball',
  name: 'Maxim',
  location: 'Norderstedt',
  company: 'Otto GmbH & Co. KGaA',
  blog: 'maximdieball.de',
  html_url: 'https://github.com/MaximDieball',
  public_repos: 4,
  followers: 4,
};
const REPOS = [
  {
    name: 'maxim-os-website',
    description: 'vibe coded personal website',
    language: 'TypeScript',
    stargazers_count: 0,
    fork: false,
    html_url: 'https://github.com/MaximDieball/maxim-os-website',
  },
];

async function mockGithub(page: Page, available = true): Promise<void> {
  await page.route('https://api.github.com/**', (route) => {
    if (!available) return route.abort();
    const url = route.request().url();
    const body = url.includes('/repos') ? REPOS : PROFILE;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

test.describe('profile commands', () => {
  test('steckbrief shows portrait and GitHub profile', async ({ page }) => {
    await mockGithub(page);
    await openTerminal(page);
    await run(page, 'steckbrief');
    // Vollständiger Text über die Live-Region (mobil scrollt der Anfang aus dem Bild).
    const live = page.locator('#live');
    await expect(live).toContainText('@MaximDieball');
    await expect(live).toContainText('Norderstedt');
    await expect(terminalOutput(page)).toContainText('Daten von GitHub');
    await expect(page).toHaveScreenshot('steckbrief.png');
  });

  test('steckbrief falls back to the content folder without GitHub', async ({ page }) => {
    await mockGithub(page, false);
    await openTerminal(page);
    await run(page, 'steckbrief');
    await expect(terminalOutput(page)).toContainText('gespeicherte Daten');
  });

  test('projects lists projects with clickable links', async ({ page }) => {
    await mockGithub(page);
    await openTerminal(page);
    await run(page, 'projects');
    await expect(terminalOutput(page)).toContainText(
      'https://github.com/MaximDieball/maxim-os-website',
    );
    // window.open aufzeichnen: geprüft wird genau der Aufruf der Seite (neuer Tab, noopener).
    await page.evaluate(() => {
      const calls: string[][] = [];
      (window as unknown as { __opened: string[][] }).__opened = calls;
      window.open = (url?: string | URL, target?: string, features?: string) => {
        calls.push([String(url), String(target), String(features)]);
        return null;
      };
    });
    // Die Zeile mit dem Link-Anfang anklicken (mobil ist der Link umgebrochen; die Seite
    // setzt ihn wieder zusammen). Textzeilen haben pointer-events: none, also per Position.
    const row = page
      .locator('.xterm-rows > div')
      .filter({ hasText: 'https://github.com/MaximDieball/' })
      .first();
    const box = (await row.boundingBox())!;
    await page.mouse.click(box.x + 80, box.y + box.height / 2);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: string[][] }).__opened))
      .toEqual([
        ['https://github.com/MaximDieball/maxim-os-website', '_blank', 'noopener,noreferrer'],
      ]);
  });

  test('about, whoami and history', async ({ page }) => {
    await openTerminal(page);
    await run(page, 'about');
    await expect(terminalOutput(page)).toContainText('an ai coding project');
    await run(page, 'whoami');
    await expect(terminalOutput(page)).toContainText('Du bist Gast');
    await run(page, 'history');
    await expect.poll(async () => (await visibleLines(page)).at(-2)).toBe('   3  history');
  });
});
