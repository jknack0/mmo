import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { WebSocket } from 'ws';
import Redis from 'ioredis';
import { AddressInfo } from 'node:net';
import {
  encodeClientMessage,
  decodeServerMessage,
  createSnapshotReconstructor,
  type ServerMessage,
  type ZoneSnapshot,
} from '@mmo/protocol';
import { buildChannelServer, type ChannelServer } from './channel-server.js';

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';

const TEST_MAP = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));

async function sendHello(
  ws: WebSocket,
  payload: { sessionToken: string; characterId: string; name: string }
): Promise<void> {
  ws.send(encodeClientMessage({ type: 'hello', ...payload }));
}

async function waitFor<T extends ServerMessage>(
  ws: WebSocket,
  predicate: (m: ServerMessage) => m is T,
  timeoutMs = 2000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('waitFor timed out')), timeoutMs);
    const handler = (data: WebSocket.RawData) => {
      let msg: ServerMessage;
      try {
        msg = decodeServerMessage(data as Uint8Array);
      } catch {
        return;
      }
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

const isWelcome = (m: ServerMessage): m is Extract<ServerMessage, { type: 'welcome' }> =>
  m.type === 'welcome';
const isError = (m: ServerMessage): m is Extract<ServerMessage, { type: 'error' }> =>
  m.type === 'error';
const isDamage = (m: ServerMessage): m is Extract<ServerMessage, { type: 'damage' }> =>
  m.type === 'damage';

// Delta snapshots (S24): the server streams keyframe/delta frames. Attach a
// persistent reconstructor that rebuilds full ZoneSnapshots, and poll for a
// predicate against the latest reconstructed state.
function trackSnapshots(ws: WebSocket): { waitForSnap: (pred: (s: ZoneSnapshot) => boolean, timeoutMs?: number) => Promise<ZoneSnapshot> } {
  const recon = createSnapshotReconstructor();
  let latest: ZoneSnapshot | null = null;
  ws.on('message', (data: WebSocket.RawData) => {
    let msg: ServerMessage;
    try { msg = decodeServerMessage(data as Uint8Array); } catch { return; }
    const s = recon.ingest(msg);
    if (s) latest = s;
  });
  return {
    waitForSnap(pred, timeoutMs = 3000) {
      return vi.waitFor(() => {
        if (!latest || !pred(latest)) throw new Error('snapshot predicate not met');
        return latest;
      }, { timeout: timeoutMs, interval: 30 });
    },
  };
}

describe('ChannelServer', () => {
  let redis: Redis;
  let server: ChannelServer;
  let wsUrl: string;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL);
    server = buildChannelServer({
      redis,
      zone: { size: { x: 10, y: 10 }, tileMap: TEST_MAP },
      mobs: [
        { id: 'skel-1', kind: 'skeleton', pos: { x: 5, y: 6 }, maxHp: 24, respawnMs: 5000 },
      ],
      tickHz: 50, // faster ticks for snappier tests
    });
    await server.start(0);
    const addr = server.address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${addr.port}`;
  });

  beforeEach(async () => {
    await redis.flushdb();
    // Reset shared zone state (mobs persist across tests inside one server).
    const zone = server.zoneState();
    for (const mob of zone.mobs.values()) {
      mob.hp = mob.maxHp;
      mob.alive = true;
      mob.respawnAt = null;
      mob.pos = { ...mob.spawnPos };
    }
  });

  afterAll(async () => {
    await server.stop();
    await redis.quit();
  });

  function connectClient(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }

  async function issueSession(accountId: string): Promise<string> {
    const token = `tok-${Math.random().toString(36).slice(2, 10)}`;
    await redis.set(`session:${token}`, accountId, 'EX', 60);
    return token;
  }

  it('sends Welcome on a valid Hello', async () => {
    const token = await issueSession('acct-1');
    const ws = await connectClient();
    void sendHello(ws, { sessionToken: token, characterId: 'char-1', name: 'Alice' });
    const welcome = await waitFor(ws, isWelcome);
    expect(welcome.you).toMatch(/.+/);
    expect(welcome.zoneSize).toEqual({ x: 10, y: 10 });
    expect(welcome.tileMap).toEqual(TEST_MAP);
    ws.close();
  });

  it('rejects an unknown session with Error + closes', async () => {
    const ws = await connectClient();
    void sendHello(ws, {
      sessionToken: 'never-issued',
      characterId: 'char-x',
      name: 'X',
    });
    const err = await waitFor(ws, isError);
    expect(err.reason).toBe('invalid-token');
    await new Promise<void>((r) =>
      ws.once('close', () => r())
    );
  });

  it('broadcasts snapshots after Hello', async () => {
    const token = await issueSession('acct-2');
    const ws = await connectClient();
    const track = trackSnapshots(ws);
    void sendHello(ws, { sessionToken: token, characterId: 'char-2', name: 'Bob' });
    await waitFor(ws, isWelcome);
    await track.waitForSnap((s) => !!s.players.find((p) => p.name === 'Bob'));
    ws.close();
  });

  it('applies a Move command and the new position appears in the next snapshot', async () => {
    const token = await issueSession('acct-3');
    const ws = await connectClient();
    const track = trackSnapshots(ws);
    void sendHello(ws, { sessionToken: token, characterId: 'char-3', name: 'Cara' });
    const welcome = await waitFor(ws, isWelcome);
    const myId = welcome.you;

    // Settle: confirm spawn shows up.
    await track.waitForSnap((s) => !!s.players.find((p) => p.id === myId));
    ws.send(encodeClientMessage({ type: 'move', target: { x: 8, y: 8 } }));

    // Wait for the player to make visible progress toward the target (started at 5,5).
    await track.waitForSnap((s) => {
      const me = s.players.find((p) => p.id === myId);
      return !!me && me.pos.x > 5;
    });
    ws.close();
  });

  it('removes a player from the zone when their socket closes', async () => {
    const aToken = await issueSession('acct-a');
    const bToken = await issueSession('acct-b');

    const a = await connectClient();
    const b = await connectClient();
    const trackB = trackSnapshots(b);

    void sendHello(a, { sessionToken: aToken, characterId: 'char-a', name: 'A' });
    void sendHello(b, { sessionToken: bToken, characterId: 'char-b', name: 'B' });

    await waitFor(a, isWelcome);
    await waitFor(b, isWelcome);

    // Confirm B sees A.
    await trackB.waitForSnap((s) => s.players.some((p) => p.name === 'A'));

    a.close();

    // Now B should stop seeing A.
    await trackB.waitForSnap((s) => !s.players.some((p) => p.name === 'A'));

    b.close();
  });

  it('broadcasts a Damage event when a valid Attack lands', async () => {
    const token = await issueSession('acct-atk');
    const ws = await connectClient();
    const track = trackSnapshots(ws);
    void sendHello(ws, { sessionToken: token, characterId: 'char-atk', name: 'Atk' });
    const welcome = await waitFor(ws, isWelcome);
    // Get spawned at centre (5,5) and the mob is at (5,6) → in range.
    // Wait a beat so the mob snapshot has propagated.
    await track.waitForSnap((s) => s.mobs.length > 0);

    ws.send(
      encodeClientMessage({ type: 'attack', targetId: 'skel-1', skillId: 'basic-attack' })
    );

    const dmg = await waitFor(ws, isDamage);
    expect(dmg.event.targetId).toBe('skel-1');
    expect(dmg.event.attackerId).toBe(welcome.you);
    expect(dmg.event.amount).toBeGreaterThan(0);
    expect(dmg.event.fatal).toBe(false);
    ws.close();
  });

  it('emits a fatal Damage event when the killing blow lands (FSM auto-fires)', async () => {
    // The mob has 24 HP; basic-attack does 12 → 2 hits to kill.
    // With the sticky-attack FSM, one Attack message engages the target
    // and the tick loop fires damage every cooldown until the mob dies.
    const token = await issueSession('acct-kill');
    const ws = await connectClient();
    const track = trackSnapshots(ws);
    void sendHello(ws, { sessionToken: token, characterId: 'char-kill', name: 'K' });
    await waitFor(ws, isWelcome);
    await track.waitForSnap((s) => s.mobs.length > 0);

    ws.send(encodeClientMessage({ type: 'attack', targetId: 'skel-1', skillId: 'basic-attack' }));

    // Collect Damage events until a fatal one shows up.
    const fatal = await new Promise<typeof ws extends WebSocket ? any : any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no fatal hit within 3s')), 3000);
      const handler = (data: WebSocket.RawData) => {
        let msg: ServerMessage;
        try { msg = decodeServerMessage(data as Uint8Array); } catch { return; }
        if (msg.type === 'damage' && msg.event.fatal) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(msg);
        }
      };
      ws.on('message', handler);
    });
    expect((fatal as { event: { targetId: string } }).event.targetId).toBe('skel-1');
    ws.close();
  });
});
