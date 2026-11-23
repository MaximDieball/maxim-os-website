import { expect, test, type Page } from '@playwright/test';
import { PROMPT_TEXT, openTerminal, run, terminalOutput, visibleLines } from '../helpers.ts';

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

/**
 * Klickt auf einen Text in der Ausgabe. Textzeilen haben pointer-events: none, also per
 * Position: der letzte Abschnitt (span) mit diesem Text, kurz hinter seinem Anfang.
 */
async function clickText(page: Page, text: string): Promise<void> {
  // Erst klicken, wenn alles gezeichnet ist und der leere Prompt unten steht.
  await expect.poll(async () => (await visibleLines(page)).at(-1)).toBe(PROMPT_TEXT);
  const span = page.locator('.xterm-rows span').filter({ hasText: text }).last();
  // Kleine Bildschirme: xterm zeigt nur sichtbare Zeilen, also ggf. hochscrollen.
  const screen = (await page.locator('.xterm-screen').boundingBox())!;
  const wheel = async (dy: number): Promise<void> => {
    await page.mouse.move(screen.x + screen.width / 2, screen.y + screen.height / 2);
    await page.mouse.wheel(0, dy);
  };
  let scrolled = 0;
  let box: { x: number; y: number; width: number; height: number } | null = null;
  // xterm zeichnet Zeilen neu: Position erneut lesen, bis sie stabil vorliegt.
  for (let i = 0; i < 20 && !box; i++) {
    box = await span.boundingBox({ timeout: 300 }).catch(() => null);
    if (!box && scrolled < 10 && !(await span.isVisible())) {
      await wheel(-60);
      scrolled++;
    }
  }
  if (!box) throw new Error(`Text nicht gefunden: ${text}`);
  await page.mouse.click(box.x + Math.min(20, box.width / 2), box.y + box.height / 2);
  // Zurück zum Prompt wie ein Nutzer: Tippen scrollt ans Ende (ein Link gibt keine Ausgabe).
  if (scrolled) {
    await page.keyboard.type('x');
    await page.keyboard.press('Backspace');
  }
}

const README = '# MAXIM OS\n\nEin **Terminal** im Browser.\n\n- Steckbrief\n- Projekte\n';

async function mockGithub(page: Page, available = true): Promise<void> {
  await page.route('https://api.github.com/**', (route) => {
    if (!available) return route.abort();
    const url = route.request().url();
    if (url.endsWith('/readme')) {
      return route.fulfill({ status: 200, contentType: 'text/plain', body: README });
    }
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
    await expect(live).toContainText('Nordakademie');
    await expect(terminalOutput(page)).toContainText('Daten von GitHub');
    await expect(page).toHaveScreenshot('steckbrief.png');
  });

  test('steckbrief falls back to the content folder without GitHub', async ({ page }) => {
    await mockGithub(page, false);
    await openTerminal(page);
    await run(page, 'steckbrief');
    await expect(terminalOutput(page)).toContainText('gespeicherte Daten');
  });

  test('clicking a project opens its page with README and links', async ({ page }) => {
    await mockGithub(page);
    await openTerminal(page);
    await run(page, 'projects');
    await expect(terminalOutput(page)).toContainText('vibe coded personal website');
    await expect(terminalOutput(page)).not.toContainText('https://');
    const clickRow = (text: string) => clickText(page, text);
    await clickRow('maxim-os-website');
    const live = page.locator('#live');
    await expect(live).toContainText('Ein Terminal im Browser.');
    await expect(live).toContainText('https://github.com/MaximDieball/maxim-os-website');
    await expect(terminalOutput(page)).toContainText('Alle Projekte');

    // Der GitHub-Link der Projektseite öffnet einen neuen Tab (window.open aufzeichnen).
    await page.evaluate(() => {
      const calls: string[][] = [];
      (window as unknown as { __opened: string[][] }).__opened = calls;
      window.open = (url?: string | URL, target?: string, features?: string) => {
        calls.push([String(url), String(target), String(features)]);
        return null;
      };
    });
    await page.keyboard.press('Control+L');
    await run(page, 'project maxim-os-website');
    await expect(live).toContainText('Ein Terminal im Browser.');
    await clickRow('https://');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __opened: string[][] }).__opened))
      .toEqual([
        ['https://github.com/MaximDieball/maxim-os-website', '_blank', 'noopener,noreferrer'],
      ]);

    // "Alle Projekte" führt wieder 'projects' aus.
    await clickRow('Alle Projekte');
    await expect
      .poll(async () => (await visibleLines(page)).join('\n'))
      .toContain('project <name>');
  });

  test('steckbrief lists the projects clickable', async ({ page }) => {
    await mockGithub(page);
    await openTerminal(page);
    await run(page, 'steckbrief');
    await clickText(page, 'maxim-os-website');
    await expect(page.locator('#live')).toContainText('Ein Terminal im Browser.');
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
