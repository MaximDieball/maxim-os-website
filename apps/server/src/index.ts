import { buildApp } from './app.ts';
import { status as pingJava } from 'minecraft-server-util';
import { createAsk } from './ask.ts';
import { buildSystemPrompt } from './ask-prompt.ts';
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

// KI-Assistent (#73): nur über LLM_URL im internen Netz; LLM_URL="" schaltet /api/ask ab.
const llmUrl = process.env.LLM_URL ?? 'http://llm:8080';
let logAskError: (error: unknown) => void = () => {};
const ask = llmUrl
  ? createAsk({
      llmUrl,
      apiKey: process.env.LLM_API_KEY || undefined,
      systemPrompt: buildSystemPrompt(snapshot),
      onError: (error) => logAskError(error),
    })
  : undefined;

const app = await buildApp({
  publicDir,
  snapshot,
  version: process.env.APP_VERSION,
  minecraft,
  ask,
});
logAskError = (error) =>
  app.log.warn(
    { reason: error instanceof Error ? error.message : 'unknown' },
    'llm request failed',
  );
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
