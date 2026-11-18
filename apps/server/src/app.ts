import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  CommandRequestSchema,
  CompleteRequestSchema,
  findCommand,
  parseArgs,
  type CommandResult,
  type CompleteResponse,
  type ErrorResponse,
  type HealthResponse,
} from '@maxim-os/shared';
import { completePath, SERVER_HANDLERS } from './fs/commands.ts';
import type { Sandbox } from './fs/sandbox.ts';

export interface RateLimitOptions {
  /** Anfragen pro Client (IP) und Zeitfenster. */
  perClient: number;
  /** Anfragen insgesamt pro Zeitfenster (der Tunnel reicht evtl. keine echte IP durch). */
  global: number;
  windowMs: number;
}

export interface AppOptions {
  logger?: boolean;
  /** Ordner mit dem gebauten Frontend. Ohne Angabe wird nichts statisch ausgeliefert. */
  publicDir?: string;
  /** Sandbox für das simulierte Dateisystem. Ohne Angabe keine FS-Commands. */
  sandbox?: Sandbox;
  rateLimit?: RateLimitOptions;
}

const BODY_LIMIT_BYTES = 4 * 1024;
const DEFAULT_RATE_LIMIT: RateLimitOptions = { perClient: 120, global: 1200, windowMs: 60_000 };
const TOO_MANY = 'Zu viele Anfragen. Bitte kurz warten.';

class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

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

  // Sicherheits-Header inkl. CSP. xterm.js setzt Inline-Styles, Skripte nur vom eigenen Origin.
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  });

  // Rate-Limits: pro Client (Plugin) und global (eigener Zähler).
  const limits = options.rateLimit ?? DEFAULT_RATE_LIMIT;
  await app.register(fastifyRateLimit, {
    global: false,
    max: limits.perClient,
    timeWindow: limits.windowMs,
    errorResponseBuilder: () => new HttpError(429, TOO_MANY),
  });
  let windowStart = Date.now();
  let globalCount = 0;
  const globalLimit = async (): Promise<void> => {
    const now = Date.now();
    if (now - windowStart >= limits.windowMs) {
      windowStart = now;
      globalCount = 0;
    }
    if (++globalCount > limits.global) throw new HttpError(429, TOO_MANY);
  };
  // preHandler läuft nach dem Pro-Client-Limit (onRequest): abgewiesene Anfragen zählen nicht global.
  const limited = { config: { rateLimit: {} }, preHandler: globalLimit };

  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok' }));

  const sandbox = options.sandbox;
  if (sandbox) {
    app.post('/api/command', limited, async (request): Promise<CommandResult> => {
      const parsed = CommandRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError(400, 'invalid body');
      const { cwd, name, args } = parsed.data;

      // Nur serverseitige Commands aus der Registry (Allowlist).
      const spec = findCommand(name);
      const handler = spec?.side === 'server' ? SERVER_HANDLERS.get(spec.name) : undefined;
      if (!spec || !handler) throw new HttpError(400, 'unknown command');

      const argv = parseArgs(spec, args);
      if (!argv.ok) return { kind: 'error', message: argv.error };

      // Das Verzeichnis kommt vom Client und wird bei jedem Request neu geprüft.
      const dir = await sandbox.resolveCwd(cwd);
      if (!dir.ok) {
        return {
          kind: 'error',
          message: `Aktueller Ordner ungültig: ${dir.error}`,
          resetCwd: true,
        };
      }

      return handler({ sandbox, cwd: dir.path, flags: argv.flags, operands: argv.operands });
    });

    app.post('/api/complete', limited, async (request): Promise<CompleteResponse> => {
      const parsed = CompleteRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError(400, 'invalid body');
      const dir = await sandbox.resolveCwd(parsed.data.cwd);
      if (!dir.ok) return { candidates: [] };
      return { candidates: await completePath(sandbox, dir.path, parsed.data.partial) };
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
