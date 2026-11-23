import { describe, expect, it } from 'vitest';
import { availableSuggestions, START_SUGGESTIONS } from './suggestions.ts';

describe('start suggestions (#99)', () => {
  it('only offers registered commands, in the given order', () => {
    const commands = availableSuggestions().map((s) => s.command);
    expect(commands.slice(0, 3)).toEqual(['projects', 'watchthis', 'snake']);
    // minecraft steht schon in der Liste und erscheint, sobald es den Command gibt (mvp-6)
    expect(START_SUGGESTIONS.map((s) => s.command)).toContain('minecraft');
    expect(availableSuggestions([{ command: 'nope', hint: 'x' }])).toEqual([]);
  });
});
