import type { Terminal } from '@xterm/xterm';
import type { TouchScrollDebug } from './touch-scroll.ts';

/**
 * Diagnose für Touch-Scrolling auf echten Geräten (#46). Nur im Dev-Server mit
 * `?debug=touch`: kleine Box oben rechts mit Zählern und Messwerten, die man
 * als Screenshot zurückschicken kann.
 */
export function createTouchDebug(term: Terminal): TouchScrollDebug {
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;top:4px;right:4px;z-index:50;margin:0;padding:6px 8px;max-width:62vw;' +
    'font:11px/1.35 monospace;color:#fff;background:rgba(40,0,60,.85);border-radius:6px;' +
    'pointer-events:none;white-space:pre-wrap;';
  document.body.append(box);

  const counts: Record<string, number> = {};
  let last: Record<string, unknown> = {};
  let lastEvent = '-';
  let scrolled = 0;

  // Kommen die Events überhaupt an? Zählt alles, was das Fenster sieht.
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    window.addEventListener(
      type,
      (e) => {
        counts[`win:${type}`] = (counts[`win:${type}`] ?? 0) + 1;
        const t = e.target as Element | null;
        last.target = t ? `${t.tagName.toLowerCase()}.${t.className || '-'}`.slice(0, 40) : '-';
        render();
      },
      { capture: true, passive: true },
    );
  }

  const render = (): void => {
    const b = term.buffer.active;
    const vv = window.visualViewport;
    box.textContent = [
      `ua: ${navigator.userAgent.match(/(iPhone|Android|Mac)[^;)]*/)?.[0] ?? '?'}`,
      ...Object.entries(counts).map(([k, v]) => `${k}: ${v}`),
      `last: ${lastEvent} ${JSON.stringify(last)}`,
      `scrolled lines: ${scrolled}`,
      `buffer: viewportY=${b.viewportY} baseY=${b.baseY} len=${b.length} rows=${term.rows}`,
      `window.scrollY=${Math.round(window.scrollY)} vv.top=${Math.round(vv?.offsetTop ?? 0)} vv.h=${Math.round(vv?.height ?? 0)}`,
    ].join('\n');
  };
  render();

  return {
    event(type, info) {
      counts[type] = (counts[type] ?? 0) + 1;
      if (type === 'scroll') scrolled += Number(info.lines) || 0;
      lastEvent = type;
      last = { ...last, ...info };
      render();
    },
  };
}
