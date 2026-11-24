import { expect, test, type Page } from '@playwright/test';
import { idle, openTerminal, run, terminalOutput, toBottom } from '../helpers.ts';

// minecraft (#36). Der Website-Server wird im Browser abgefangen, es wird nie wirklich gepingt.
async function mockStatus(page: Page, body: unknown, status = 200): Promise<void> {
  await page.route('**/api/minecraft', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

test.describe('minecraft', () => {
  test('shows status, players and ping', async ({ page }) => {
    await mockStatus(page, {
      online: true,
      address: 'minecraft.maxim-dieball.de',
      version: 'Paper 1.21.4',
      motd: 'Willkommen auf meinem Server',
      players: { online: 3, max: 20, names: ['Maxim_D', 'Steve', 'Alex'] },
      latencyMs: 42,
    });
    await openTerminal(page);
    await run(page, 'minecraft');
    await toBottom(page);
    const out = terminalOutput(page);
    await expect(out).toContainText('● online');
    await expect(out).toContainText('3 / 20');
    await expect(out).toContainText('Maxim_D, Steve, Alex');
    await expect(out).toContainText('42 ms');
    await expect(page).toHaveScreenshot('minecraft.png');
  });

  test('is friendly when the server is offline', async ({ page }) => {
    await mockStatus(page, { online: false, address: 'minecraft.maxim-dieball.de' });
    await openTerminal(page);
    await run(page, 'mc');
    await idle(page);
    await expect(terminalOutput(page)).toContainText('gerade offline');
  });

  test('reports when the status cannot be fetched', async ({ page }) => {
    await mockStatus(page, { error: 'Interner Fehler.' }, 500);
    await openTerminal(page);
    await run(page, 'minecraft');
    await idle(page);
    await expect(terminalOutput(page)).toContainText('Status gerade nicht abrufbar');
  });

  test('appears among the start suggestions', async ({ page }) => {
    await openTerminal(page);
    await expect(page.locator('#suggestions button')).toHaveText([
      /projects/,
      /watchthis/,
      /snake/,
      /minecraft/,
    ]);
  });
});
