import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AuthService } from '../auth/auth-service.js';
import type { AuthError } from '../auth/types.js';

export interface GatewayServerOptions {
  auth: AuthService;
  /** Origin the client SPA is served from. Discord callback redirects here. */
  clientOrigin: string;
}

const AUTH_ERROR_STATUS: Record<AuthError, number> = {
  'invalid-credentials': 401,
  'email-already-exists': 400,
  'weak-password': 400,
  'discord-state-invalid': 400,
  'discord-exchange-failed': 400,
};

function setCors(res: ServerResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.end();
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

export function buildGatewayServer(opts: GatewayServerOptions): Server {
  const { auth, clientOrigin } = opts;

  return createServer(async (req, res) => {
    try {
      setCors(res, clientOrigin);

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', `http://localhost`);

      // ─── POST /auth/email/register ────────────────────────────
      if (req.method === 'POST' && url.pathname === '/auth/email/register') {
        const body = await readJsonBody<{ email?: string; password?: string }>(req);
        if (!body.email || !body.password) {
          sendJson(res, 400, { error: 'missing-fields' });
          return;
        }
        const outcome = await auth.authenticate({
          kind: 'email-register',
          email: body.email,
          password: body.password,
        });
        if (outcome.ok) {
          sendJson(res, 200, {
            sessionToken: outcome.sessionToken,
            accountId: outcome.accountId,
          });
        } else {
          sendJson(res, AUTH_ERROR_STATUS[outcome.error], { error: outcome.error });
        }
        return;
      }

      // ─── POST /auth/email/login ───────────────────────────────
      if (req.method === 'POST' && url.pathname === '/auth/email/login') {
        const body = await readJsonBody<{ email?: string; password?: string }>(req);
        if (!body.email || !body.password) {
          sendJson(res, 400, { error: 'missing-fields' });
          return;
        }
        const outcome = await auth.authenticate({
          kind: 'email-login',
          email: body.email,
          password: body.password,
        });
        if (outcome.ok) {
          sendJson(res, 200, {
            sessionToken: outcome.sessionToken,
            accountId: outcome.accountId,
          });
        } else {
          sendJson(res, AUTH_ERROR_STATUS[outcome.error], { error: outcome.error });
        }
        return;
      }

      // ─── GET /auth/discord/start ──────────────────────────────
      if (req.method === 'GET' && url.pathname === '/auth/discord/start') {
        const { url: discordUrl } = await auth.generateDiscordOAuthStart();
        redirect(res, discordUrl);
        return;
      }

      // ─── GET /auth/discord/callback ───────────────────────────
      if (req.method === 'GET' && url.pathname === '/auth/discord/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (!code || !state) {
          redirect(res, `${clientOrigin}/?error=missing-discord-params`);
          return;
        }
        const outcome = await auth.authenticate({ kind: 'discord-code', code, state });
        if (outcome.ok) {
          const target = new URL(clientOrigin);
          target.searchParams.set('session', outcome.sessionToken);
          redirect(res, target.toString());
        } else {
          const target = new URL(clientOrigin);
          target.searchParams.set('error', outcome.error);
          redirect(res, target.toString());
        }
        return;
      }

      // ─── GET /health ──────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: 'not-found' });
    } catch (err) {
      console.error('[gateway] handler error:', err);
      sendJson(res, 500, { error: 'internal' });
    }
  });
}
