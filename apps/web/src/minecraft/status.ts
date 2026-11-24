import type { MinecraftStatus } from '@maxim-os/shared';
import { clean } from '../shell/format.ts';
import type { LineAction, Output } from '../shell/shell.ts';
import { style, wrap } from '../shell/text.ts';

/**
 * Minecraft-Status im Browser (#36): fragt GET /api/minecraft (der Server pingt und
 * cached). `undefined` heißt: Website-Server nicht erreichbar oder Route nicht da.
 */
export async function loadMinecraft(
  options: { fetch?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<MinecraftStatus | undefined> {
  const doFetch = options.fetch ?? fetch;
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs ?? 6000);
  try {
    const res = await doFetch('/api/minecraft', { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Partial<MinecraftStatus> | null;
    if (!body || typeof body.address !== 'string' || typeof body.online !== 'boolean') {
      return undefined;
    }
    return body as MinecraftStatus;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

const LABEL = 9;

/** Übersicht für das Terminal; Werte brechen auf schmalen Screens in ihrer Spalte um. */
export function formatMinecraft(status: MinecraftStatus, cols: number): Output {
  const width = Math.max(20, cols - 1);
  const lines: string[] = [];
  const actions: (LineAction | undefined)[] = [];
  const field = (label: string, value: string | undefined): void => {
    if (!value) return;
    wrap(clean(value), Math.max(10, width - LABEL)).forEach((l, i) =>
      lines.push(`${i === 0 ? style.dim(label.padEnd(LABEL)) : ' '.repeat(LABEL)}${l}`),
    );
  };

  const state = status.online ? style.green('● online') : style.red('○ offline');
  lines.push(`${style.bold(style.cyan('Minecraft-Server'))}  ${state}`, '');
  field('Adresse', status.address);
  if (!status.online) {
    lines.push('');
    for (const l of wrap('Der Server ist gerade offline. Schau später nochmal vorbei.', width)) {
      lines.push(style.dim(l));
    }
    return { lines, actions };
  }
  field('Version', status.version);
  const { online, max, names } = status.players;
  field('Spieler', `${online} / ${max}`);
  if (names.length) {
    const more = online > names.length ? ` +${online - names.length}` : '';
    for (const l of wrap(`${names.join(', ')}${more}`, Math.max(10, width - LABEL))) {
      lines.push(`${' '.repeat(LABEL)}${style.green(clean(l))}`);
    }
  }
  if (status.latencyMs !== undefined) field('Ping', `${status.latencyMs} ms`);
  if (status.motd) {
    const motd = status.motd.split('\n');
    motd.forEach((m, i) => field(i === 0 ? 'MOTD' : '', m));
  }
  return { lines, actions };
}
