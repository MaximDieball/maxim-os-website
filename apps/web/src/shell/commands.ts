import { COMMANDS } from '@maxim-os/shared';
import { formatHelp } from './help.ts';
import type { ClientHandler, CommandContext } from './shell.ts';
import { truncate } from './text.ts';

/** Lehnt jeden Parameter ab (Allowlist: diese Commands haben keine). */
function noArgs(ctx: CommandContext, name: string): boolean {
  if (ctx.args.length === 0) return true;
  ctx.out.print([`${name}: unerwarteter Parameter: ${truncate(ctx.args[0]!, 40)}`]);
  return false;
}

/** Clientseitige Handler, Schlüssel ist der Registry-Name. */
export const CLIENT_HANDLERS: Readonly<Record<string, ClientHandler>> = Object.freeze({
  help: (ctx) => {
    if (noArgs(ctx, 'help')) ctx.out.print(formatHelp(COMMANDS, ctx.out.cols()));
  },
  clear: (ctx) => {
    if (noArgs(ctx, 'clear')) ctx.out.clear();
  },
});
