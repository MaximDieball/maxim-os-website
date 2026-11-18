import { COMMANDS } from '@maxim-os/shared';
import { formatHelp } from './help.ts';
import type { ClientHandler } from './shell.ts';

/**
 * Clientseitige Handler, Schlüssel ist der Registry-Name. Flags und Argumente
 * sind vorher schon gegen die Registry geprüft (parseArgs in Shell.execute).
 */
export const CLIENT_HANDLERS: Readonly<Record<string, ClientHandler>> = Object.freeze({
  help: (ctx) => ctx.out.print(formatHelp(COMMANDS, ctx.out.cols())),
  clear: (ctx) => ctx.out.clear(),
});
