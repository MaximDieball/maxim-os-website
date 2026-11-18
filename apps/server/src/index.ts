import { buildApp } from './app.ts';
import { buildAllowlist, Sandbox } from './fs/sandbox.ts';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '0.0.0.0';
const publicDir = process.env.PUBLIC_DIR || undefined;
const contentDir = process.env.CONTENT_DIR || '/content';

// Allowlist einmal beim Start erzeugen, nur im Speicher. Ohne Content-Ordner kein Start.
const allowlist = await buildAllowlist(contentDir);
const app = await buildApp({ publicDir, sandbox: new Sandbox(allowlist) });
app.log.info({ entries: allowlist.size }, 'content allowlist ready');

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await app.listen({ port, host });
