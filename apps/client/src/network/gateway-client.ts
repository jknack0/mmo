// HTTP helpers for the gateway. (The auth-client already covers the auth
// endpoints; this file holds session-authenticated calls.)

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';

export interface ConnectInfo {
  wsUrl: string;
  channelId: string;
  zoneId?: string;
  character: { id: string; name: string };
}

/**
 * Resolve which channel WS to join. `zoneId` requests a specific zone (S17 zone
 * transitions); `channelId` is a manual channel-switch (S04). Both optional —
 * omitting them lands the player in the default open-world zone.
 */
export async function connect(
  sessionToken: string,
  characterId: string,
  zoneId?: string,
  channelId?: string
): Promise<ConnectInfo> {
  const res = await fetch(`${GATEWAY_URL}/connect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ characterId, zoneId, channelId }),
  });
  if (!res.ok) throw new Error(`gateway /connect failed: ${res.status}`);
  return (await res.json()) as ConnectInfo;
}
