import { describe, expect, it } from 'vitest';
import type { MinecraftStatus } from '@maxim-os/shared';
import { stripAnsi } from '../shell/text.ts';
import { formatMinecraft, loadMinecraft } from './status.ts';

const ONLINE: MinecraftStatus = {
  online: true,
  address: 'minecraft.maxim-dieball.de',
  version: 'Paper 1.21.4',
  motd: 'Willkommen auf meinem Server\nzweite Zeile',
  players: { online: 5, max: 20, names: ['Maxim_D', 'Steve'] },
  latencyMs: 42,
};
const plain = (s: MinecraftStatus, cols = 80) => formatMinecraft(s, cols).lines.map(stripAnsi);

describe('formatMinecraft', () => {
  it('shows status, address, version, players, ping and motd', () => {
    const text = plain(ONLINE).join('\n');
    for (const s of [
      'Minecraft-Server  ● online',
      'minecraft.maxim-dieball.de',
      'Paper 1.21.4',
      '5 / 20',
      'Maxim_D, Steve +3',
      '42 ms',
      'Willkommen auf meinem Server',
      'zweite Zeile',
    ]) {
      expect(text).toContain(s);
    }
  });

  it('is friendly when the server is offline', () => {
    const text = plain({ online: false, address: 'mc.example' }).join('\n');
    expect(text).toContain('○ offline');
    expect(text).toContain('gerade offline');
    expect(text).not.toContain('Spieler');
  });

  it('fits narrow screens', () => {
    const many = {
      ...ONLINE,
      players: { online: 12, max: 20, names: Array(12).fill('Player_Name12') },
    };
    for (const l of plain(many, 36)) expect(l.length).toBeLessThanOrEqual(36);
  });

  it('removes control characters from server texts', () => {
    const evil = { ...ONLINE, motd: 'a\u001b]0;x\u0007b' };
    expect(formatMinecraft(evil, 80).lines.join('')).not.toContain('\u001b]');
  });
});

describe('loadMinecraft', () => {
  const respond = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('returns the status from the server', async () => {
    expect(await loadMinecraft({ fetch: respond(200, ONLINE) })).toEqual(ONLINE);
  });

  it('returns undefined when the website server cannot answer', async () => {
    expect(await loadMinecraft({ fetch: respond(404, {}) })).toBeUndefined();
    expect(await loadMinecraft({ fetch: respond(200, { nope: true }) })).toBeUndefined();
    const broken = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await loadMinecraft({ fetch: broken })).toBeUndefined();
  });
});
