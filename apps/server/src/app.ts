import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ErrorResponse, HealthResponse } from '@maxim-os/shared';

export interface AppOptions {
  logger?: boolean;
  /** Ordner mit dem gebauten Frontend. Ohne Angabe wird nichts statisch ausgeliefert. */
  publicDir?: string;
}

const BODY_LIMIT_BYTES = 4 * 1024;

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: BODY_LIMIT_BYTES,
    // Hinter dem Tunnel nicht blind Proxy-Headern vertrauen.
    trustProxy: false,
  });

  // Keine Stacktraces, keine Hostpfade: Fehler werden nur geloggt, nie ausgeliefert.
  app.setErrorHandler((error, request, reply) => {
    const code = (error as { statusCode?: unknown } | null)?.statusCode;
    const status = typeof code === 'number' && code >= 400 && code < 500 ? 400 : 500;
    if (status === 500) request.log.error({ err: error }, 'request failed');
    const body: ErrorResponse = {
      error: status === 400 ? 'Ungültige Anfrage.' : 'Interner Fehler.',
    };
    void reply.status(status).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    const body: ErrorResponse = { error: 'Nicht gefunden.' };
    void reply.status(404).send(body);
  });

  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));

  if (options.publicDir) {
    await app.register(fastifyStatic, {
      root: options.publicDir,
      index: ['index.html'],
      dotfiles: 'deny',
      redirect: false,
    });
  }

  return app;
}
