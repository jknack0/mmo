// WebSocket load-test rig (S25 #27, ADR-0012). Spins up N headless clients
// against one channel, drives a representative input mix (move / attack / dodge),
// and reports inbound bandwidth + connection outcomes. Pair with the channel's
// `tickStats()` to confirm the 20Hz loop holds under the ADR-0011 50-player cap.
//
// Reusable post-alpha: import `runLoad` from a test or the CLI (loadtest/index.ts).

import { WebSocket } from 'ws';
import type Redis from 'ioredis';
import { encodeClientMessage, decodeServerMessage, type ServerMessage } from '@mmo/protocol';

export interface LoadOptions {
  wsUrl: string;
  redis: Redis;
  /** Concurrent clients to simulate. */
  clients: number;
  /** How long to drive the workload, ms. */
  durationMs: number;
  zoneSize?: { x: number; y: number };
  /** Per-client input cadence, ms (default 250 → 4 inputs/s). */
  inputIntervalMs?: number;
  /** 1 in N inputs is a combat action instead of a move (default 4). */
  combatEvery?: number;
  /** Mob id clients attack (must exist in the zone). Default 'skel-1'. */
  targetMobId?: string;
}

export interface LoadResult {
  clients: number;
  welcomed: number;
  /** Joins refused because the channel was at capacity (ADR-0011). */
  channelFull: number;
  /** Connection-level errors other than channel-full (token, malformed…). */
  connectionErrors: number;
  /** Gameplay rejections (e.g. out-of-range attack) — not failures. */
  gameplayErrors: number;
  framesReceived: number;
  bytesReceived: number;
  durationMs: number;
  bytesPerSecond: number;
  bytesPerClientPerSecond: number;
  /** Process memory/CPU sampled across the run (in-process = clients+server). */
  rssMb: number;
  heapUsedMb: number;
  cpuUserMs: number;
  cpuSystemMs: number;
}

const CONNECTION_REASONS = new Set(['channel-full', 'invalid-token', 'expected-hello', 'malformed']);

export async function runLoad(opts: LoadOptions): Promise<LoadResult> {
  const { wsUrl, redis, clients, durationMs } = opts;
  const zoneSize = opts.zoneSize ?? { x: 30, y: 30 };
  const inputIntervalMs = opts.inputIntervalMs ?? 250;
  const combatEvery = opts.combatEvery ?? 4;
  const targetMobId = opts.targetMobId ?? 'skel-1';

  let welcomed = 0, channelFull = 0, connectionErrors = 0, gameplayErrors = 0;
  let framesReceived = 0, bytesReceived = 0;
  const sockets: WebSocket[] = [];
  const timers: NodeJS.Timeout[] = [];

  // Pre-register a session per client so Hello authenticates.
  await Promise.all(
    Array.from({ length: clients }, (_, i) => redis.set(`session:load-${i}`, `load-acct-${i}`, 'EX', 120))
  );

  const cpu0 = process.cpuUsage();

  await Promise.all(
    Array.from({ length: clients }, (_, i) => new Promise<void>((resolve) => {
      const ws = new WebSocket(wsUrl);
      sockets.push(ws);
      let n = 0;
      const settle = setTimeout(resolve, 1500); // resolve even if open never fires

      ws.on('open', () => {
        clearTimeout(settle);
        ws.send(encodeClientMessage({ type: 'hello', sessionToken: `load-${i}`, characterId: `load-char-${i}`, name: `L${i}` }));
        const timer = setInterval(() => {
          if (ws.readyState !== ws.OPEN) return;
          n++;
          if (combatEvery && n % combatEvery === 0) {
            ws.send(encodeClientMessage(n % (combatEvery * 2) === 0
              ? { type: 'dodge' }
              : { type: 'attack', targetId: targetMobId, skillId: 'spark' }));
          } else {
            ws.send(encodeClientMessage({
              type: 'move',
              target: { x: 1 + Math.floor(Math.random() * (zoneSize.x - 2)), y: 1 + Math.floor(Math.random() * (zoneSize.y - 2)) },
            }));
          }
        }, inputIntervalMs);
        timers.push(timer);
        resolve();
      });

      ws.on('message', (data) => {
        const bytes = data as Buffer;
        bytesReceived += bytes.byteLength ?? bytes.length ?? 0;
        framesReceived++;
        let msg: ServerMessage;
        try { msg = decodeServerMessage(bytes); } catch { return; }
        if (msg.type === 'welcome') welcomed++;
        else if (msg.type === 'error') {
          if (msg.reason === 'channel-full') channelFull++;
          else if (CONNECTION_REASONS.has(msg.reason)) connectionErrors++;
          else gameplayErrors++;
        }
      });
      ws.on('error', () => { clearTimeout(settle); resolve(); });
    }))
  );

  await new Promise((r) => setTimeout(r, durationMs));

  for (const t of timers) clearInterval(t);
  await Promise.all(sockets.map((ws) => new Promise<void>((res) => {
    if (ws.readyState === ws.CLOSED) return res();
    ws.once('close', () => res());
    try { ws.close(); } catch { res(); }
  })));

  const cpu = process.cpuUsage(cpu0);
  const mem = process.memoryUsage();
  const seconds = durationMs / 1000;
  return {
    clients, welcomed, channelFull, connectionErrors, gameplayErrors,
    framesReceived, bytesReceived, durationMs,
    bytesPerSecond: bytesReceived / seconds,
    bytesPerClientPerSecond: bytesReceived / seconds / Math.max(1, clients),
    rssMb: mem.rss / 1e6,
    heapUsedMb: mem.heapUsed / 1e6,
    cpuUserMs: cpu.user / 1000,
    cpuSystemMs: cpu.system / 1000,
  };
}
