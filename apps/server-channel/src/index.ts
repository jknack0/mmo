// Channel-server bootstrap. Owns one channel of one zone per ADR-0011.
// Currently a single hardcoded zone (the alpha vertical-slice test zone).
// ChannelRouter / multi-zone routing lands in S04 (#6).

import 'dotenv/config';
import Redis from 'ioredis';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { buildChannelServer } from './channel-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotenv({ path: path.resolve(__dirname, '../../../.env') });

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/0';
const CHANNEL_PORT = Number.parseInt(process.env.CHANNEL_PORT ?? '8081', 10);
const ZONE_SIZE = { x: 30, y: 30 };

// Alpha test zone: open grid with a couple of decorative blockers so the
// tile-collision system actually has something to enforce.
function buildTestTileMap(size: { x: number; y: number }): number[][] {
  const map: number[][] = [];
  for (let y = 0; y < size.y; y++) {
    const row: number[] = [];
    for (let x = 0; x < size.x; x++) {
      const onBorder = x === 0 || y === 0 || x === size.x - 1 || y === size.y - 1;
      const decorativeRock = (x === 10 && y === 10) || (x === 20 && y === 18);
      row.push(onBorder || decorativeRock ? 1 : 0);
    }
    map.push(row);
  }
  return map;
}

async function main(): Promise<void> {
  const redis = new Redis(REDIS_URL);
  const server = buildChannelServer({
    redis,
    zone: { size: ZONE_SIZE, tileMap: buildTestTileMap(ZONE_SIZE) },
  });

  await server.start(CHANNEL_PORT);
  console.log(`[channel] listening on ws://localhost:${CHANNEL_PORT}`);
  console.log(`[channel] zone ${ZONE_SIZE.x}×${ZONE_SIZE.y}, tick 20Hz`);

  const shutdown = async () => {
    console.log('[channel] shutting down…');
    await server.stop();
    await redis.quit();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[channel] fatal:', err);
  process.exit(1);
});
