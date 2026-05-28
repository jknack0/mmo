import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AuthService } from '../auth/auth-service.js';
import type { AuthError } from '../auth/types.js';
import type { CharacterService, CharacterError } from '../character/character-service.js';
import { requireAccount } from './require-account.js';

export interface GatewayServerOptions {
  auth: AuthService;
  characters: CharacterService;
  /** Origin the client SPA is served from. Discord callback redirects here. */
  clientOrigin: string;
  /** WS URL of the single hardcoded channel (until S04 wires ChannelRouter). */
  channelWsUrl: string;
}

const AUTH_ERROR_STATUS: Record<AuthError, number> = {
  'invalid-credentials': 401,
  'email-already-exists': 400,
  'weak-password': 400,
  'discord-state-invalid': 400,
  'discord-exchange-failed': 400,
};

const CHARACTER_ERROR_STATUS: Record<CharacterError, number> = {
  'name-taken': 409,
  'name-too-short': 400,
  'name-too-long': 400,
  'name-invalid-chars': 400,
};

const PLAY_PATH = /^\/characters\/([0-9a-f-]{36})\/play$/;

function setCors(res: ServerResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
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
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

export function buildGatewayServer(opts: GatewayServerOptions): Server {
  const { auth, characters, clientOrigin, channelWsUrl } = opts;

  return createServer(async (req, res) => {
    try {
      setCors(res, clientOrigin);

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', 'http://localhost');

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

      // ─── GET /me ──────────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/me') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        sendJson(res, 200, { accountId: session.accountId });
        return;
      }

      // ─── GET /characters ──────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/characters') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const list = await characters.listCharacters(session.accountId);
        sendJson(res, 200, { characters: list });
        return;
      }

      // ─── POST /characters ─────────────────────────────────────
      if (req.method === 'POST' && url.pathname === '/characters') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const body = await readJsonBody<{ name?: string }>(req);
        if (!body.name) {
          sendJson(res, 400, { error: 'missing-fields' });
          return;
        }
        const outcome = await characters.createCharacter(session.accountId, body.name);
        if (outcome.ok) {
          sendJson(res, 201, { character: outcome.character });
        } else {
          sendJson(res, CHARACTER_ERROR_STATUS[outcome.error], { error: outcome.error });
        }
        return;
      }

      // ─── POST /connect ────────────────────────────────────────
      if (req.method === 'POST' && url.pathname === '/connect') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const body = await readJsonBody<{ characterId?: string }>(req);
        if (!body.characterId) {
          sendJson(res, 400, { error: 'missing-fields' });
          return;
        }
        const character = await characters.loadCharacter(
          session.accountId,
          body.characterId
        );
        if (!character) {
          sendJson(res, 404, { error: 'character-not-found' });
          return;
        }
        sendJson(res, 200, {
          wsUrl: channelWsUrl,
          channelId: 'alpha-test-zone-ch0',
          character: { id: character.id, name: character.name },
        });
        return;
      }

      // ─── POST /characters/:id/play ────────────────────────────
      if (req.method === 'POST') {
        const playMatch = PLAY_PATH.exec(url.pathname);
        if (playMatch) {
          const session = await requireAccount(req, res, auth);
          if (!session) return;
          const characterId = playMatch[1]!;
          const character = await characters.loadCharacter(session.accountId, characterId);
          if (!character) {
            sendJson(res, 404, { error: 'character-not-found' });
            return;
          }
          sendJson(res, 200, { character });
          return;
        }
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
