// ChannelRouter (S04 #6, ADR-0011) — the deep module that decides which channel
// process a joining player connects to. The routing table lives in Redis:
//   channel:zone:{zoneId}   → set of channelIds in that zone
//   channel:meta:{channelId} → JSON {zoneId, processUrl, currentLoad}, TTL'd
// Channel processes heartbeat their load every few seconds; the TTL means a
// crashed channel's meta expires and it's pruned from the zone set on read, so
// the router never routes players into a dead process.

import type { RedisClient } from '../redis/client.js';
import { pickChannel, capForZone, type ChannelInfo } from './pick.js';

/** Seconds a channel's meta survives without a heartbeat before it's pruned. */
export const CHANNEL_META_TTL_SEC = 15;

const zoneKey = (zoneId: string) => `channel:zone:${zoneId}`;
const metaKey = (channelId: string) => `channel:meta:${channelId}`;

export interface RegisterInput extends ChannelInfo {
  zoneId: string;
}

/** Spins up a new channel for a zone when all existing channels are full. */
export type ChannelSpawner = (zoneId: string) => Promise<ChannelInfo | null>;

export type RouteResult =
  | { wsUrl: string; channelId: string }
  | { error: 'preferred-full' | 'at-capacity' };

export interface RouteOptions {
  /** Manual channel-switch: force this channel id if it has room. */
  preferred?: string;
  /** Override the zone cap (tests; cap-of-1 capacity validation). */
  capOverride?: number;
}

export interface ChannelRouter {
  registerChannel(input: RegisterInput): Promise<void>;
  heartbeat(channelId: string, currentLoad: number): Promise<void>;
  listChannels(zoneId: string): Promise<ChannelInfo[]>;
  routeToChannel(zoneId: string, accountId: string, opts?: RouteOptions): Promise<RouteResult>;
}

interface ChannelMeta {
  zoneId: string;
  processUrl: string;
  currentLoad: number;
}

export function createChannelRouter(
  redis: RedisClient,
  spawner?: ChannelSpawner
): ChannelRouter {
  async function writeMeta(channelId: string, meta: ChannelMeta): Promise<void> {
    await redis.set(metaKey(channelId), JSON.stringify(meta), 'EX', CHANNEL_META_TTL_SEC);
  }

  const router: ChannelRouter = {
    async registerChannel(input) {
      await redis.sadd(zoneKey(input.zoneId), input.channelId);
      await writeMeta(input.channelId, {
        zoneId: input.zoneId,
        processUrl: input.processUrl,
        currentLoad: input.currentLoad,
      });
    },

    async heartbeat(channelId, currentLoad) {
      const raw = await redis.get(metaKey(channelId));
      if (!raw) return; // channel never registered (or already expired)
      const meta = JSON.parse(raw) as ChannelMeta;
      meta.currentLoad = currentLoad;
      await redis.sadd(zoneKey(meta.zoneId), channelId); // self-heal set membership
      await writeMeta(channelId, meta);
    },

    async listChannels(zoneId) {
      const ids = await redis.smembers(zoneKey(zoneId));
      const out: ChannelInfo[] = [];
      for (const channelId of ids) {
        const raw = await redis.get(metaKey(channelId));
        if (!raw) {
          // Meta expired → channel is dead. Prune it from the zone set.
          await redis.srem(zoneKey(zoneId), channelId);
          continue;
        }
        const meta = JSON.parse(raw) as ChannelMeta;
        out.push({ channelId, processUrl: meta.processUrl, currentLoad: meta.currentLoad });
      }
      return out;
    },

    async routeToChannel(zoneId, _accountId, opts = {}) {
      const cap = opts.capOverride ?? capForZone(zoneId);
      const channels = await router.listChannels(zoneId);
      const pick = pickChannel(channels, cap, opts.preferred);

      if (pick.kind === 'existing') {
        return { wsUrl: pick.channel.processUrl, channelId: pick.channel.channelId };
      }
      if (pick.kind === 'preferred-full') {
        return { error: 'preferred-full' };
      }
      // kind === 'spawn' — all channels full.
      if (!spawner) return { error: 'at-capacity' };
      const spawned = await spawner(zoneId);
      if (!spawned) return { error: 'at-capacity' };
      await router.registerChannel({ zoneId, ...spawned });
      return { wsUrl: spawned.processUrl, channelId: spawned.channelId };
    },
  };

  return router;
}
