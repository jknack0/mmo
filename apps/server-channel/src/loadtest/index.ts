// Load-test CLI (S25 #27). Drives a *separately running* channel process so the
// memory/CPU numbers are clean per-process. Usage:
//
//   WS_URL=ws://localhost:8081 CLIENTS=50 DURATION_MS=15000 \
//     pnpm --filter @mmo/server-channel loadtest
//
// Tick stats come from the channel itself (server.tickStats()); the CLI here
// measures the client-side outcome + inbound bandwidth.

import Redis from 'ioredis';
import { runLoad } from './load-rig.js';

const REDIS_URL = process.env.REDIS_URL ?? process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/0';
const WS_URL = process.env.WS_URL ?? 'ws://localhost:8081';
const CLIENTS = Number(process.env.CLIENTS ?? 50);
const DURATION_MS = Number(process.env.DURATION_MS ?? 10_000);

async function main(): Promise<void> {
  const redis = new Redis(REDIS_URL);
  console.log(`[loadtest] ${CLIENTS} clients → ${WS_URL} for ${DURATION_MS}ms`);
  const r = await runLoad({ wsUrl: WS_URL, redis, clients: CLIENTS, durationMs: DURATION_MS });
  const secs = DURATION_MS / 1000;
  console.log('─'.repeat(48));
  console.log(`welcomed            ${r.welcomed} / ${r.clients}`);
  console.log(`channel-full        ${r.channelFull}`);
  console.log(`connection errors   ${r.connectionErrors}`);
  console.log(`gameplay rejects    ${r.gameplayErrors}`);
  console.log(`frames received     ${r.framesReceived} (${Math.round(r.framesReceived / secs)}/s)`);
  console.log(`inbound bandwidth   ${(r.bytesReceived / 1024).toFixed(1)} KB  (${Math.round(r.bytesPerSecond / 1024)} KB/s, ${Math.round(r.bytesPerClientPerSecond)} B/s per client)`);
  console.log(`rss / heap          ${r.rssMb.toFixed(0)} MB / ${r.heapUsedMb.toFixed(0)} MB`);
  console.log(`cpu (user/sys)      ${r.cpuUserMs.toFixed(0)} / ${r.cpuSystemMs.toFixed(0)} ms`);
  console.log('─'.repeat(48));
  await redis.quit();
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
