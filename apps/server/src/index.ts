import { buildApp } from './app.ts';
import { status as pingJava } from 'minecraft-server-util';
import { createMinecraftStatus } from './minecraft.ts';
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
// Minecraft-Server (#35): Adresse aus der Umgebung; MINECRAFT_HOST="" schaltet die Route ab.
const minecraftHost = process.env.MINECRAFT_HOST ?? 'minecraft.maxim-dieball.de';
const minecraftPort = Number.parseInt(process.env.MINECRAFT_PORT ?? '25565', 10);
let logError: (error: unknown) => void = () => {};
const minecraft =
  minecraftHost && Number.isInteger(minecraftPort) && minecraftPort > 0 && minecraftPort < 65536
    ? createMinecraftStatus({
        host: minecraftHost,
        port: minecraftPort,
        ping: (host, port, timeout) => pingJava(host, port, { timeout, enableSRV: true }),
        onError: (error) => logError(error),
      })
    : undefined;

const app = await buildApp({ publicDir, snapshot, version: process.env.APP_VERSION, minecraft });
// Nur die Meldung loggen, keine Details an den Client (Regel 4)
logError = (error) =>
  app.log.warn(
    { reason: error instanceof Error ? error.message : 'unknown' },
    'minecraft ping failed',
  );
app.log.info(
  { app: process.env.APP_VERSION ?? 'dev', content: snapshot.version, skipped: skipped.length },
  'content snapshot ready',
);
for (const s of skipped) app.log.warn(s, 'content entry skipped');

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await app.listen({ port, host });
