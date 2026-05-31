// Channel self-registration / heartbeat (S04 #6, ADR-0011). A channel process
// publishes itself into the routing table the gateway's ChannelRouter reads:
//   channel:zone:{zoneId}    → set of channelIds
//   channel:meta:{channelId} → JSON {zoneId, processUrl, currentLoad}, TTL'd
//
// Mirrors the gateway ChannelRouter's key layout (kept local per the
// established per-app store pattern — tripod-store / passive-store / item-repo
// all mirror gateway SQL/Redis rather than cross-importing). The TTL means a
// crashed channel falls out of routing automatically once heartbeats stop.

import type Redis from 'ioredis';

export const CHANNEL_META_TTL_SEC = 15;

const zoneKey = (zoneId: string) => `channel:zone:${zoneId}`;
const metaKey = (channelId: string) => `channel:meta:${channelId}`;

export interface ChannelIdentity {
  zoneId: string;
  channelId: string;
  processUrl: string;
}

/** Write (or refresh) this channel's routing entry with its current load. */
export async function heartbeatChannel(
  redis: Redis,
  id: ChannelIdentity,
  currentLoad: number
): Promise<void> {
  await redis.sadd(zoneKey(id.zoneId), id.channelId);
  await redis.set(
    metaKey(id.channelId),
    JSON.stringify({ zoneId: id.zoneId, processUrl: id.processUrl, currentLoad }),
    'EX',
    CHANNEL_META_TTL_SEC
  );
}

/** Remove this channel from routing on graceful shutdown. */
export async function deregisterChannel(redis: Redis, id: ChannelIdentity): Promise<void> {
  await redis.srem(zoneKey(id.zoneId), id.channelId);
  await redis.del(metaKey(id.channelId));
}
