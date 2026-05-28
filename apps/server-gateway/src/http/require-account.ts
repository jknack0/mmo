import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from '../auth/auth-service.js';

/**
 * Reads a Bearer token from the Authorization header, validates it via
 * AuthService, and returns the resolved account id. On any failure
 * (missing / malformed / expired token) writes a 401 to `res` and returns
 * null — callers can early-return when null is returned.
 */
export async function requireAccount(
  req: IncomingMessage,
  res: ServerResponse,
  auth: AuthService
): Promise<{ accountId: string } | null> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'missing-token' }));
    return null;
  }

  const session = await auth.validateSession(token);
  if (!session) {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'invalid-token' }));
    return null;
  }

  return session;
}
