import { describe, expect, it } from 'vitest';
import { cellWidth, renderPromptLine } from './prompt-line.ts';

const P = '\x1b[32m>\x1b[39m '; // sichtbar: "> " (2 Zellen)
const INV = (s: string) => `\x1b[7m${s}\x1b[27m`;

describe('cellWidth', () => {
  it('counts ASCII as one cell', () => expect(cellWidth('help')).toBe(4));
  it('counts CJK and emoji as two cells', () => {
    expect(cellWidth('日本')).toBe(4);
    expect(cellWidth('a😀')).toBe(3);
  });
});

describe('renderPromptLine', () => {
  it('draws the prompt with a block cursor at the end', () => {
    const r = renderPromptLine(P, { value: '', caret: 0, focused: true }, 40, 0);
    expect(r.seq).toBe(`\r\x1b[J${P}${INV(' ')}`);
    expect(r.rows).toBe(0);
  });

  it('moves up to the first row of the previous render before redrawing', () => {
    const r = renderPromptLine(P, { value: 'x', caret: 1, focused: true }, 40, 2);
    expect(r.seq.startsWith('\x1b[2A\r\x1b[J')).toBe(true);
  });

  it('puts the cursor on the character under the caret', () => {
    const r = renderPromptLine(P, { value: 'abc', caret: 2, focused: true }, 40, 0);
    expect(r.seq).toBe(`\r\x1b[J${P}ab${INV('c')}`);
  });

  it('draws no cursor without focus', () => {
    const r = renderPromptLine(P, { value: 'abc', caret: 3, focused: false }, 40, 0);
    expect(r.seq).toBe(`\r\x1b[J${P}abc `);
    expect(r.seq).not.toContain('\x1b[7m');
  });

  it('counts wrapped rows (cursor cell included)', () => {
    // 2 (Prompt) + 7 + 1 (Cursor) = 10 Zellen: passt genau in eine Zeile
    expect(renderPromptLine(P, { value: 'abcdefg', caret: 7, focused: true }, 10, 0).rows).toBe(0);
    // 11 Zellen: zweite Zeile
    expect(renderPromptLine(P, { value: 'abcdefgh', caret: 8, focused: true }, 10, 0).rows).toBe(1);
    // Caret mitten im Text: keine zusätzliche Cursor-Zelle
    expect(renderPromptLine(P, { value: 'abcdefgh', caret: 3, focused: true }, 10, 0).rows).toBe(0);
    expect(
      renderPromptLine(P, { value: 'a'.repeat(30), caret: 30, focused: true }, 10, 0).rows,
    ).toBe(3);
  });

  it('keeps surrogate pairs intact under the cursor', () => {
    const r = renderPromptLine(P, { value: 'a😀', caret: 1, focused: true }, 40, 0);
    expect(r.seq).toBe(`\r\x1b[J${P}a${INV('😀')}`);
  });
});
