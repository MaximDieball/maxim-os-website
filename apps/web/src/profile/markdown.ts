import { clean } from '../shell/format.ts';
import { style, wrap } from '../shell/text.ts';

/**
 * Sehr kleiner Markdown-Renderer für READMEs im Terminal (#89). Kein vollständiges
 * Markdown: Überschriften, Absätze, Listen, Code-Blöcke, Links und Bilder werden
 * lesbar dargestellt, HTML-Tags entfernt. Alles wird gefiltert (clean).
 */

/** Inline-Markdown zu Text: Bilder, Links, Code, Betonung, HTML-Tags. */
function inline(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => `[Bild${alt ? `: ${alt}` : ''}]`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
      /^https?:\/\//.test(url) ? `${label} (${url})` : label,
    )
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2')
    .trim();
}

export function renderMarkdown(markdown: string, cols: number, maxLines = 200): string[] {
  const width = Math.max(20, cols - 1);
  const out: string[] = [];
  let paragraph: string[] = [];
  let inCode = false;
  /** Vorige Zeile war ein Listenpunkt (dann keine Leerzeile dazwischen). */
  let inList = false;

  const blank = (): void => {
    if (out.length && out.at(-1) !== '') out.push('');
  };
  const flush = (): void => {
    if (!paragraph.length) return;
    const text = inline(paragraph.join(' '));
    paragraph = [];
    if (!text) return;
    blank();
    out.push(...wrap(text, width));
  };

  for (const raw of clean(markdown.replace(/\r\n?/g, '\n').replace(/\t/g, '  ')).split('\n')) {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(style.dim(`    ${line}`));
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (!bullet && !numbered) inList = false;
    if (heading) {
      flush();
      const text = inline(heading[2]!.replace(/\s#+\s*$/, ''));
      if (!text) continue;
      blank();
      out.push(heading[1]!.length <= 2 ? style.bold(style.cyan(text)) : style.bold(text));
    } else if (bullet || numbered) {
      flush();
      if (!inList) blank();
      inList = true;
      const marker = bullet ? '•' : `${numbered![1]}.`;
      const text = inline((bullet ? bullet[1] : numbered![2])!);
      const lines = wrap(text, width - 4 - marker.length);
      lines.forEach((l, i) =>
        out.push(i === 0 ? `  ${marker} ${l}` : `${' '.repeat(3 + marker.length)}${l}`),
      );
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
    } else if (line.trim() === '') {
      flush();
    } else {
      // Fortsetzung einer Liste ohne Leerzeile bleibt ein eigener Absatz
      paragraph.push(line.trim().replace(/^>\s?/, ''));
    }
  }
  flush();
  while (out[0] === '') out.shift();
  while (out.at(-1) === '') out.pop();

  if (out.length > maxLines) {
    return [...out.slice(0, maxLines), style.dim('… (gekürzt)')];
  }
  return out;
}
