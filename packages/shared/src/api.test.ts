import { describe, expect, it } from 'vitest';
import { CommandRequestSchema, CompleteRequestSchema } from './api.ts';

describe('CommandRequestSchema', () => {
  it('accepts a valid request', () => {
    const r = CommandRequestSchema.safeParse({ cwd: '/', name: 'ls', args: ['-l'] });
    expect(r.success).toBe(true);
  });

  it('rejects unknown keys, wrong types and missing fields', () => {
    expect(CommandRequestSchema.safeParse({ cwd: '/', name: 'ls', args: [], x: 1 }).success).toBe(
      false,
    );
    expect(CommandRequestSchema.safeParse({ cwd: '/', name: 'ls', args: 'x' }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ cwd: 1, name: 'ls', args: [] }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ name: 'ls', args: [] }).success).toBe(false);
    expect(CommandRequestSchema.safeParse(null).success).toBe(false);
  });

  it('enforces length limits', () => {
    const ok = { cwd: '/', name: 'ls', args: [] as string[] };
    expect(CommandRequestSchema.safeParse({ ...ok, cwd: `/${'a'.repeat(2000)}` }).success).toBe(
      false,
    );
    expect(CommandRequestSchema.safeParse({ ...ok, name: 'x'.repeat(33) }).success).toBe(false);
    expect(CommandRequestSchema.safeParse({ ...ok, args: Array(17).fill('a') }).success).toBe(
      false,
    );
    expect(CommandRequestSchema.safeParse({ ...ok, args: ['a'.repeat(300)] }).success).toBe(false);
  });

  it('requires cwd to be an absolute simulated path', () => {
    expect(CommandRequestSchema.safeParse({ cwd: 'docs', name: 'ls', args: [] }).success).toBe(
      false,
    );
  });
});

describe('CompleteRequestSchema', () => {
  it('accepts a partial path and rejects extras', () => {
    expect(CompleteRequestSchema.safeParse({ cwd: '/', partial: 'do' }).success).toBe(true);
    expect(CompleteRequestSchema.safeParse({ cwd: '/', partial: 'do', y: 1 }).success).toBe(false);
  });
});
