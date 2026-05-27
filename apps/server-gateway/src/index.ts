// SPIKE: Gateway service.
// Real role per ADR-0011: handles auth/lobby/character-select/channel-routing.
// In the spike: a single HTTP endpoint that hands back the (only) channel's WS URL.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { GatewayConnectResponse } from '@mmo/protocol';

const PORT = 8080;
const CHANNEL_URL = process.env.CHANNEL_URL ?? 'ws://localhost:8081';

const server = createServer((req, res) => {
  // CORS for local dev — client runs on 5173, gateway on 8080.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/connect' && req.method === 'GET') {
    const name = url.searchParams.get('name') ?? 'Anon';
    const playerId = randomUUID();
    const token = randomUUID(); // SPIKE: not validated by channel beyond existence.

    const body: GatewayConnectResponse = {
      channelUrl: CHANNEL_URL,
      playerId,
      token,
    };

    console.log(`[gateway] handshake name=${name} playerId=${playerId}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`[gateway] listening on http://localhost:${PORT}`);
  console.log(`[gateway] handshake endpoint: GET /connect?name=<displayName>`);
  console.log(`[gateway] will route to channel: ${CHANNEL_URL}`);
});
