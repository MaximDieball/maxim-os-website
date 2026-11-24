import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@maxim-os/shared';
import { buildSystemPrompt } from './ask-prompt.ts';

const T = '2026-01-01T00:00:00.000Z';
const file = (name: string, text: string) => ({
  type: 'file' as const,
  name,
  mtime: T,
  size: 0,
  text,
});

describe('buildSystemPrompt', () => {
  it('adds public infos from content/about to the fixed role', () => {
    const snap: Snapshot = {
      version: 'v',
      root: {
        type: 'dir',
        name: '',
        mtime: T,
        children: [
          {
            type: 'dir',
            name: 'about',
            mtime: T,
            children: [
              file('about.txt', 'MAXIM OS ist ein Terminal.'),
              file(
                'steckbrief.json',
                JSON.stringify({
                  profile: { name: 'Maxim', location: 'Norderstedt' },
                  facts: [{ label: 'Studium', value: 'Nordakademie' }],
                  repos: [{ name: 'ChessBot', language: 'Python' }],
                }),
              ),
            ],
          },
        ],
      },
    };
    const prompt = buildSystemPrompt(snap);
    expect(prompt).toContain('keine Werkzeuge');
    expect(prompt).toContain('MAXIM OS ist ein Terminal.');
    expect(prompt).toContain('- Studium: Nordakademie');
    expect(prompt).toContain('- Projekt ChessBot: Python');
  });

  it('lists the commands of the website and explains the CMD line', () => {
    const prompt = buildSystemPrompt(undefined);
    expect(prompt).toContain('- minecraft:');
    expect(prompt).toContain('- ls:');
    expect(prompt).toContain('CMD:');
  });

  it('works without content', () => {
    expect(buildSystemPrompt(undefined)).toContain('Assistent der persönlichen Website');
  });
});
