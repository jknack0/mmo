// Channel-server bootstrap. Owns one channel of one zone per ADR-0011. The zone
// is selected by ZONE_ID and loaded from the shared zone defs (S17): size,
// collision map, mob spawns, NPCs and portals all come from the def. Run one
// process per zone (ashen-plains + hold-veridian) — see the root `dev` script.

import 'dotenv/config';
import Redis from 'ioredis';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { getZoneDef, buildZoneTileMap, ASHEN_PLAINS, RIFT_T1 } from '@mmo/domain';
import { buildChannelServer } from './channel-server.js';
import { buildRiftServer } from './rift-server.js';
import { createChannelDb } from './db/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotenv({ path: path.resolve(__dirname, '../../../.env') });

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/0';
const DATABASE_URL = process.env.DATABASE_URL;
const ZONE_ID = process.env.ZONE_ID ?? ASHEN_PLAINS;
const CHANNEL_PORT = Number.parseInt(process.env.CHANNEL_PORT ?? '8081', 10);
const CHANNEL_ID = process.env.CHANNEL_ID ?? `${ZONE_ID}-ch0`;
const CHANNEL_WS_URL = process.env.CHANNEL_WS_URL ?? `ws://localhost:${CHANNEL_PORT}`;

async function main(): Promise<void> {
  const def = getZoneDef(ZONE_ID);
  if (!def) {
    console.error(`[channel] unknown ZONE_ID "${ZONE_ID}"`);
    process.exit(1);
  }

  const redis = new Redis(REDIS_URL);
  // Postgres handle enables write-through drops/pickups + equipped-gear load
  // (S13, ADR-0013). Without DATABASE_URL the channel still runs, sans items.
  const db = DATABASE_URL ? createChannelDb(DATABASE_URL) : undefined;
  if (!db) console.warn('[channel] DATABASE_URL unset — item drops/pickups disabled.');

  // The Rift is instanced — a different server (per-party private dungeons).
  const server =
    ZONE_ID === RIFT_T1
      ? buildRiftServer({ redis, db, zoneId: ZONE_ID, channelId: CHANNEL_ID, processUrl: CHANNEL_WS_URL })
      : buildChannelServer({
          redis,
          db,
          zoneId: ZONE_ID,
          channelId: CHANNEL_ID,
          processUrl: CHANNEL_WS_URL,
          capacity: Number.parseInt(process.env.CHANNEL_CAPACITY ?? String(def.cap), 10),
          zone: { size: def.size, tileMap: buildZoneTileMap(ZONE_ID) },
          mobs: def.mobs.map((m) => ({ id: m.id, kind: m.kind, pos: { ...m.pos }, maxHp: m.maxHp })),
        });

  await server.start(CHANNEL_PORT);
  console.log(`[channel] ${def.name} (${ZONE_ID}) on ws://localhost:${CHANNEL_PORT}`);

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
