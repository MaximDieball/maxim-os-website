import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ErrorResponse, HealthResponse, Snapshot } from '@maxim-os/shared';

export interface RateLimitOptions {
  /** Anfragen an /api/* insgesamt pro Zeitfenster. */
  max: number;
  windowMs: number;
}

export interface AppOptions {
  logger?: boolean;
  /** Ordner mit dem gebauten Frontend. Ohne Angabe wird nichts statisch ausgeliefert. */
  publicDir?: string;
  /** Snapshot des Content-Ordners für GET /api/fs. */
  snapshot?: Snapshot;
  /** Build-Version (Commit-SHA) für /api/health. */
  version?: string;
  rateLimit?: RateLimitOptions;
}

const BODY_LIMIT_BYTES = 4 * 1024;
const DEFAULT_RATE_LIMIT: RateLimitOptions = { max: 1200, windowMs: 60_000 };
const TOO_MANY = 'Zu viele Anfragen. Bitte kurz warten.';

class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Der Server ist bewusst klein (CLAUDE.md, Architektur): Er liefert das Frontend,
 * den Snapshot des Content-Ordners und Health. Er nimmt keine Pfade oder Commands an.
 */
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
    if (code === 429) {
      const body: ErrorResponse = { error: TOO_MANY };
      return reply.status(429).send(body);
    }
    const status = typeof code === 'number' && code >= 400 && code < 500 ? 400 : 500;
    if (status === 500) request.log.error({ err: error }, 'request failed');
    const body: ErrorResponse = {
      error: status === 400 ? 'Ungültige Anfrage.' : 'Interner Fehler.',
    };
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    const body: ErrorResponse = { error: 'Nicht gefunden.' };
    void reply.status(404).send(body);
  });

  // Sicherheits-Header inkl. CSP. xterm.js setzt Inline-Styles; GitHub-API für den Steckbrief.
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'https://api.github.com'],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  });

  // Ein globales Limit für /api/* reicht (der Tunnel reicht evtl. keine echte IP durch).
  const limits = options.rateLimit ?? DEFAULT_RATE_LIMIT;
  await app.register(fastifyRateLimit, {
    global: false,
    max: limits.max,
    timeWindow: limits.windowMs,
    keyGenerator: () => 'global',
    errorResponseBuilder: () => new HttpError(429, TOO_MANY),
  });
  const limited = { config: { rateLimit: {} } };

  // Health hängt von nichts Externem ab (kein LLM, kein Minecraft): die Website soll auch
  // ohne diese Dienste als gesund gelten. Die Version zeigt dem Deploy-Skript den laufenden Stand.
  const version = /^[0-9a-zA-Z._-]{1,64}$/.test(options.version ?? '') ? options.version! : 'dev';
  app.get('/api/health', async (_request, reply): Promise<HealthResponse> => {
    void reply.header('cache-control', 'no-store');
    return { status: 'ok', version };
  });

  const snapshot = options.snapshot;
  if (snapshot) {
    // Einmal serialisieren; der Browser fragt mit If-None-Match nach.
    const body = JSON.stringify(snapshot);
    const etag = `"${snapshot.version}"`;
    app.get('/api/fs', limited, async (request, reply) => {
      void reply.header('etag', etag).header('cache-control', 'no-cache');
      if (request.headers['if-none-match'] === etag) return reply.status(304).send();
      return reply.type('application/json; charset=utf-8').send(body);
    });
  }

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
