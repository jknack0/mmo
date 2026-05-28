// HTTP helpers for the gateway. (The auth-client already covers the auth
// endpoints; this file holds session-authenticated calls.)

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:8080';

export interface ConnectInfo {
  wsUrl: string;
  channelId: string;
  character: { id: string; name: string };
}

export async function connect(
  sessionToken: string,
  characterId: string
): Promise<ConnectInfo> {
  const res = await fetch(`${GATEWAY_URL}/connect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ characterId }),
  });
  if (!res.ok) throw new Error(`gateway /connect failed: ${res.status}`);
  return (await res.json()) as ConnectInfo;
}
