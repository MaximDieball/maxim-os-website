import { describe, expect, it } from 'vitest';
import { COMMAND_GROUPS, COMMANDS, findCommand } from './commands.ts';

describe('command registry', () => {
  it('contains help and clear', () => {
    const names = COMMANDS.map((c) => c.name);
    expect(names).toContain('help');
    expect(names).toContain('clear');
  });

  it('has unique names and aliases', () => {
    const all = COMMANDS.flatMap((c) => [c.name, ...c.aliases]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('fills every field of every entry', () => {
    for (const c of COMMANDS) {
      expect(c.name).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(c.description.trim()).not.toBe('');
      expect(c.usage.trim()).not.toBe('');
      expect(c.example.trim()).not.toBe('');
    }
  });

  it('starts usage and example with the command name', () => {
    for (const c of COMMANDS) {
      expect(c.usage.split(' ')[0]).toBe(c.name);
      expect(c.example.split(' ')[0]).toBe(c.name);
    }
  });

  it('finds commands by name and alias', () => {
    expect(findCommand('help')?.name).toBe('help');
    expect(findCommand('cls')?.name).toBe('clear');
  });

  it('returns undefined for unknown or prototype names', () => {
    expect(findCommand('nope')).toBeUndefined();
    expect(findCommand('constructor')).toBeUndefined();
    expect(findCommand('__proto__')).toBeUndefined();
    expect(findCommand('')).toBeUndefined();
  });
});

describe('command order (#82)', () => {
  it('starts with steckbrief', () => {
    expect(COMMANDS[0]?.name).toBe('steckbrief');
  });

  it('is sorted by group importance for visitors', () => {
    const order = COMMAND_GROUPS.map((g) => g.id);
    const ranks = COMMANDS.map((c) => order.indexOf(c.group));
    expect(ranks.every((r) => r >= 0)).toBe(true);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('puts links before terminal projects, files and system commands', () => {
    const order = COMMAND_GROUPS.map((g) => g.id);
    expect(order).toEqual(['me', 'links', 'play', 'files', 'system']);
    expect(findCommand('projects')?.group).toBe('links');
    expect(findCommand('help')?.group).toBe('system');
    expect(findCommand('ls')?.group).toBe('files');
  });
});
