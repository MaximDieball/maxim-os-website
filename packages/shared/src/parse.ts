import type { CommandSpec } from './commands.ts';

/** Eingabe-Limits, gemeinsam für Client und Server. */
export const LIMITS = {
  /** Maximale Länge einer Eingabezeile. */
  line: 256,
  /** Maximale Anzahl Tokens (Command + Argumente). */
  tokens: 16,
  /** Maximale Länge eines Tokens bzw. Pfads in einem Argument. */
  token: 256,
  /** Maximale Länge des aktuellen Verzeichnisses. */
  cwd: 1024,
  /** Maximale Länge eines Command-Namens. */
  name: 32,
} as const;

// C0/C1-Steuerzeichen, DEL und bidi-Overrides.
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;

export type TokenizeResult = { ok: true; tokens: string[] } | { ok: false; error: string };

/** Zerlegt eine Eingabezeile in Tokens. Unterstützt "doppelte" und 'einfache' Anführungszeichen. */
export function tokenize(line: string): TokenizeResult {
  if (line.length > LIMITS.line) return { ok: false, error: 'Eingabe zu lang' };
  if (CONTROL_CHARS.test(line)) return { ok: false, error: 'Ungültige Zeichen in der Eingabe' };

  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let quote: '"' | "'" | undefined;

  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
    } else if (/\s/.test(ch)) {
      if (inToken) tokens.push(current);
      current = '';
      inToken = false;
    } else {
      current += ch;
      inToken = true;
    }
  }
  if (quote) return { ok: false, error: 'Anführungszeichen nicht geschlossen' };
  if (inToken) tokens.push(current);
  if (tokens.length > LIMITS.tokens) return { ok: false, error: 'Zu viele Argumente' };
  return { ok: true, tokens };
}

export type FlagValues = Record<string, true | number>;
export type ParseResult =
  { ok: true; flags: FlagValues; operands: string[] } | { ok: false; error: string };

/**
 * Prüft Argumente gegen die Allowlist der Registry. Unbekannte Flags,
 * Langoptionen und falsche Argumentzahlen werden abgelehnt.
 */
export function parseArgs(spec: CommandSpec, args: readonly string[]): ParseResult {
  const fail = (msg: string): ParseResult => ({ ok: false, error: `${spec.name}: ${msg}` });
  const flags: FlagValues = Object.create(null) as FlagValues;
  const operands: string[] = [];
  const byShort = new Map(spec.flags.map((f) => [f.short, f]));

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (arg === '-') return fail('ungültiges Argument: -');
    if (!arg.startsWith('-')) {
      operands.push(arg);
      continue;
    }
    if (arg.startsWith('--')) return fail(`unbekannte Option: ${arg.slice(0, 40)}`);

    // Kurz-Flags: -l, -la, -L 2, -L2
    const letters = [...arg.slice(1)];
    for (let k = 0; k < letters.length; k++) {
      const letter = letters[k]!;
      const flag = byShort.get(letter);
      if (!flag) return fail(`unbekannte Option: -${letter}`);
      if (!flag.int) {
        flags[letter] = true;
        continue;
      }
      const rest = letters.slice(k + 1).join('');
      const raw = rest !== '' ? rest : args[++i];
      if (raw === undefined) return fail(`-${letter} braucht eine Zahl`);
      if (!/^\d{1,3}$/.test(raw))
        return fail(`-${letter}: keine gültige Zahl: ${raw.slice(0, 20)}`);
      const value = Number(raw);
      if (value < flag.int.min || value > flag.int.max) {
        return fail(`-${letter}: erlaubt ist ${flag.int.min} bis ${flag.int.max}`);
      }
      flags[letter] = value;
      break;
    }
  }

  const { min, max, label } = spec.operands;
  if (operands.length > max) return fail('zu viele Argumente');
  if (operands.length < min) return fail(`${label} fehlt`);
  return { ok: true, flags, operands };
}
