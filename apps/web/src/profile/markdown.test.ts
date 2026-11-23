import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../shell/text.ts';
import { renderMarkdown } from './markdown.ts';

const plain = (md: string, cols = 60, max?: number) => renderMarkdown(md, cols, max).map(stripAnsi);

describe('renderMarkdown', () => {
  it('renders headings, paragraphs and lists', () => {
    const out = plain('# Titel\n\nEin **kurzer** Text.\n\n- eins\n* zwei\n1. drei\n');
    expect(out).toEqual(['Titel', '', 'Ein kurzer Text.', '', '  • eins', '  • zwei', '  1. drei']);
  });

  it('turns links and images into readable text', () => {
    expect(plain('Siehe [Doku](https://example.com/doku) und ![Logo](logo.png).')).toEqual([
      'Siehe Doku (https://example.com/doku) und [Bild: Logo].',
    ]);
  });

  it('keeps code blocks verbatim and indented', () => {
    const out = plain('```bash\nmake dev\n  make test\n```');
    expect(out).toEqual(['    make dev', '      make test']);
  });

  it('removes HTML tags and inline code markers', () => {
    expect(plain('<p align="center"><img src="x.png"></p>\nNutze `make ci`.')).toEqual([
      'Nutze make ci.',
    ]);
  });

  it('wraps long paragraphs to the width', () => {
    const out = plain('wort '.repeat(30), 20);
    for (const l of out) expect(l.length).toBeLessThanOrEqual(20);
    expect(out.length).toBeGreaterThan(5);
  });

  it('removes control characters', () => {
    expect(renderMarkdown('a\u001b]0;x\u0007b', 40).join('')).not.toContain('\u001b]');
  });

  it('cuts very long documents', () => {
    const out = plain(Array.from({ length: 50 }, (_, i) => `Zeile ${i}\n`).join('\n'), 40, 10);
    expect(out.length).toBe(11);
    expect(out.at(-1)).toContain('gekürzt');
  });
});
