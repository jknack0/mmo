import type { DiscordClient, DiscordUser } from './types.js';

export interface DiscordClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
}

const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_ME_URL = 'https://discord.com/api/users/@me';

export function createDiscordClient(config: DiscordClientConfig): DiscordClient {
  return {
    async exchangeCodeForToken(code) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUrl,
      });
      const res = await fetch(DISCORD_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!res.ok) {
        throw new Error(`discord token exchange failed: ${res.status}`);
      }
      const body = (await res.json()) as { access_token: string };
      return { accessToken: body.access_token };
    },

    async fetchUser(accessToken) {
      const res = await fetch(DISCORD_ME_URL, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`discord user fetch failed: ${res.status}`);
      }
      const body = (await res.json()) as DiscordUser;
      return body;
    },
  };
}
