import { buildApp } from './app.ts';
import { buildSnapshot } from './snapshot.ts';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '0.0.0.0';
const publicDir = process.env.PUBLIC_DIR || undefined;
const contentDir = process.env.CONTENT_DIR || '/content';

// Snapshot einmal beim Start erzeugen. Ohne Content-Ordner kein Start.
const skipped: { path: string; reason: string }[] = [];
const snapshot = await buildSnapshot(contentDir, {
  onSkip: (path, reason) => skipped.push({ path, reason }),
});
const app = await buildApp({ publicDir, snapshot });
app.log.info({ version: snapshot.version, skipped: skipped.length }, 'content snapshot ready');
for (const s of skipped) app.log.warn(s, 'content entry skipped');

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await app.listen({ port, host });
