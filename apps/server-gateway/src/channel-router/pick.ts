// Channel capacity logic (S04 #6, ADR-0011). Pure — no Redis, no I/O — so the
// "which channel does this player join" decision is unit-testable in isolation.
// Open-world zones cap at 50 (full state replication stays cheap below that);
// towns cap at 100 (no combat → CPU/network budget spent on presence).

export interface ChannelInfo {
  channelId: string;
  /** WS URL clients connect to for this channel's process. */
  processUrl: string;
  /** Players currently on this channel (heartbeated by the channel process). */
  currentLoad: number;
}

export const ZONE_CAPS: Record<string, number> = {
  'hold-veridian': 100,
};

/** Open-world zones (and anything unlisted) use the 50-player cap. */
export const DEFAULT_ZONE_CAP = 50;

export function capForZone(zoneId: string): number {
  return ZONE_CAPS[zoneId] ?? DEFAULT_ZONE_CAP;
}

export type PickResult =
  | { kind: 'existing'; channel: ChannelInfo }
  | { kind: 'spawn' }
  | { kind: 'preferred-full' };

/**
 * Choose a channel for a joining player. A `preferred` channel id (manual
 * channel-switch) wins when it exists and has room; if it's at cap we report
 * `preferred-full` so the caller can tell the client. Otherwise route to the
 * least-loaded channel under cap, or signal `spawn` when every channel is full.
 */
export function pickChannel(
  channels: ChannelInfo[],
  cap: number,
  preferred?: string
): PickResult {
  if (preferred) {
    const pref = channels.find((c) => c.channelId === preferred);
    if (pref) {
      return pref.currentLoad < cap
        ? { kind: 'existing', channel: pref }
        : { kind: 'preferred-full' };
    }
    // Unknown preferred id — fall through to normal routing.
  }

  const open = channels
    .filter((c) => c.currentLoad < cap)
    .sort((a, b) => a.currentLoad - b.currentLoad);
  if (open.length > 0) return { kind: 'existing', channel: open[0]! };
  return { kind: 'spawn' };
}
