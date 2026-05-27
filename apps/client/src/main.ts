// SPIKE: PixiJS isometric tile map client.
// Validates: tile rendering, click-to-move with server reconciliation,
// click-to-attack mob, two-tab visibility, snapshot interpolation.

import { Application, Container, Graphics, Text } from 'pixi.js';
import type {
  ClientMessage,
  ServerMessage,
  GatewayConnectResponse,
  PlayerState,
  MobState,
  Vec2,
} from '@mmo/protocol';

const GATEWAY_URL = 'http://localhost:8080';
const TILE_W = 64; // isometric tile width
const TILE_H = 32; // isometric tile height
const ATTACK_RANGE_TILES = 2;

// ─── Bootstrap ────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const displayName = params.get('name') ?? 'Anon';
const statusEl = document.getElementById('status')!;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

(async () => {
  setStatus(`handshaking as ${displayName}…`);

  const handshake = await fetch(`${GATEWAY_URL}/connect?name=${encodeURIComponent(displayName)}`)
    .then((r) => r.json() as Promise<GatewayConnectResponse>);

  setStatus(`gateway ok, opening channel ${handshake.channelUrl}…`);

  const app = new Application();
  await app.init({ background: '#1a1a22', resizeTo: window, antialias: true });
  document.getElementById('app')!.appendChild(app.canvas);

  const ws = new WebSocket(handshake.channelUrl);
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => {
    const hello: ClientMessage = { type: 'hello', token: handshake.token, name: displayName };
    ws.send(JSON.stringify(hello));
  });

  // ─── State ──────────────────────────────────────────────────────

  let myId: string | null = null;
  let zoneSize: Vec2 = { x: 20, y: 20 };
  let serverPlayers: PlayerState[] = [];
  let serverMobs: MobState[] = [];
  // Smooth-render positions (the server snapshot positions are the truth;
  // we lerp visual sprites toward them).
  const renderPlayerPos = new Map<string, Vec2>();
  const renderMobPos = new Map<string, Vec2>();

  // ─── World container ────────────────────────────────────────────

  const world = new Container();
  app.stage.addChild(world);

  // Center the iso grid in the viewport.
  function recenter(): void {
    world.x = app.screen.width / 2;
    world.y = app.screen.height / 4;
  }
  recenter();
  window.addEventListener('resize', recenter);

  // ─── Iso math ───────────────────────────────────────────────────

  function tileToScreen(t: Vec2): Vec2 {
    return {
      x: (t.x - t.y) * (TILE_W / 2),
      y: (t.x + t.y) * (TILE_H / 2),
    };
  }

  function screenToTile(s: Vec2): Vec2 {
    return {
      x: (s.x / (TILE_W / 2) + s.y / (TILE_H / 2)) / 2,
      y: (s.y / (TILE_H / 2) - s.x / (TILE_W / 2)) / 2,
    };
  }

  // ─── Tile map ───────────────────────────────────────────────────

  const tileLayer = new Container();
  world.addChild(tileLayer);

  function drawTiles(): void {
    tileLayer.removeChildren();
    for (let y = 0; y < zoneSize.y; y++) {
      for (let x = 0; x < zoneSize.x; x++) {
        const s = tileToScreen({ x, y });
        const tile = new Graphics();
        const shade = (x + y) % 2 === 0 ? 0x3a4a3a : 0x344034;
        tile.poly([
          0, -TILE_H / 2,
          TILE_W / 2, 0,
          0, TILE_H / 2,
          -TILE_W / 2, 0,
        ]).fill(shade).stroke({ color: 0x222822, width: 1 });
        tile.x = s.x;
        tile.y = s.y;
        tileLayer.addChild(tile);
      }
    }
  }

  // ─── Entity containers ──────────────────────────────────────────

  const entityLayer = new Container();
  world.addChild(entityLayer);

  const playerSprites = new Map<string, { container: Container; hpBar: Graphics }>();
  const mobSprites = new Map<string, { container: Container; hpBar: Graphics; body: Graphics }>();
  const floaters: Array<{ text: Text; vy: number; life: number }> = [];

  function makePlayerSprite(name: string, isMe: boolean) {
    const container = new Container();
    const body = new Graphics()
      .circle(0, -10, 10)
      .fill(isMe ? 0x6ab0ff : 0xff8a6a)
      .stroke({ color: 0x000000, width: 1 });
    // Feet at origin.
    const feet = new Graphics()
      .ellipse(0, 0, 10, 4)
      .fill({ color: 0x000000, alpha: 0.4 });
    const label = new Text({
      text: name,
      style: { fontSize: 11, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } },
    });
    label.anchor.set(0.5, 1);
    label.y = -26;
    const hpBar = new Graphics();
    hpBar.y = -32;
    container.addChild(feet, body, label, hpBar);
    return { container, hpBar };
  }

  function makeMobSprite() {
    const container = new Container();
    const feet = new Graphics()
      .ellipse(0, 0, 12, 5)
      .fill({ color: 0x000000, alpha: 0.5 });
    const body = new Graphics()
      .roundRect(-8, -22, 16, 22, 3)
      .fill(0xcccccc)
      .stroke({ color: 0x000000, width: 1 });
    const label = new Text({
      text: 'Skeleton',
      style: { fontSize: 10, fill: 0xdddddd, stroke: { color: 0x000000, width: 3 } },
    });
    label.anchor.set(0.5, 1);
    label.y = -30;
    const hpBar = new Graphics();
    hpBar.y = -36;
    container.addChild(feet, body, label, hpBar);
    return { container, hpBar, body };
  }

  function drawHpBar(g: Graphics, hp: number, max: number, width = 30): void {
    g.clear();
    g.rect(-width / 2, 0, width, 4).fill(0x222222);
    const pct = Math.max(0, hp / max);
    const color = pct > 0.5 ? 0x66cc66 : pct > 0.25 ? 0xddaa55 : 0xcc4444;
    g.rect(-width / 2, 0, width * pct, 4).fill(color);
  }

  function spawnFloater(at: Vec2, text: string, color = 0xffcc66): void {
    const t = new Text({
      text,
      style: { fontSize: 14, fill: color, stroke: { color: 0x000000, width: 3 }, fontWeight: 'bold' },
    });
    t.anchor.set(0.5);
    const screen = tileToScreen(at);
    t.x = screen.x;
    t.y = screen.y - 30;
    entityLayer.addChild(t);
    floaters.push({ text: t, vy: -0.6, life: 1.0 });
  }

  // ─── Message handling ───────────────────────────────────────────

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data as string) as ServerMessage;
    switch (msg.type) {
      case 'welcome':
        myId = msg.you;
        zoneSize = msg.zoneSize;
        drawTiles();
        setStatus(`connected as ${displayName} (${myId.slice(0, 8)})`);
        break;
      case 'snapshot':
        serverPlayers = msg.snapshot.players;
        serverMobs = msg.snapshot.mobs;
        // Initialize render-positions for newly seen entities.
        for (const p of serverPlayers) {
          if (!renderPlayerPos.has(p.id)) renderPlayerPos.set(p.id, { ...p.pos });
        }
        for (const m of serverMobs) {
          if (!renderMobPos.has(m.id)) renderMobPos.set(m.id, { ...m.pos });
        }
        break;
      case 'damage':
        // Show floating number above the target.
        const mob = serverMobs.find((m) => m.id === msg.event.targetId);
        if (mob) spawnFloater(mob.pos, `-${msg.event.amount}`);
        break;
      case 'error':
        console.warn('[server error]', msg.reason);
        if (msg.reason === 'out-of-range') {
          setStatus(`out of range — get closer`);
          setTimeout(() => setStatus(`connected as ${displayName} (${myId?.slice(0, 8) ?? ''})`), 1200);
        }
        break;
    }
  });

  ws.addEventListener('close', () => setStatus('disconnected'));
  ws.addEventListener('error', () => setStatus('connection error'));

  // ─── Input ──────────────────────────────────────────────────────

  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.on('pointerdown', (e) => {
    if (!myId) return;
    // Convert screen → world → tile coords.
    const wx = e.global.x - world.x;
    const wy = e.global.y - world.y;
    const tile = screenToTile({ x: wx, y: wy });

    // Did we click on a living mob? (use server positions, ~0.7 tile click radius)
    let clickedMob: MobState | undefined;
    for (const mob of serverMobs) {
      if (!mob.alive) continue;
      const dx = mob.pos.x - tile.x;
      const dy = mob.pos.y - tile.y;
      if (Math.sqrt(dx * dx + dy * dy) < 0.7) {
        clickedMob = mob;
        break;
      }
    }

    if (clickedMob) {
      const me = serverPlayers.find((p) => p.id === myId);
      if (!me) return;
      // Check approximate range; if too far, walk toward it first.
      const ddx = clickedMob.pos.x - me.pos.x;
      const ddy = clickedMob.pos.y - me.pos.y;
      if (Math.sqrt(ddx * ddx + ddy * ddy) > ATTACK_RANGE_TILES) {
        // Move adjacent to the mob first.
        const len = Math.sqrt(ddx * ddx + ddy * ddy);
        const move: ClientMessage = {
          type: 'move',
          target: {
            x: clickedMob.pos.x - (ddx / len) * (ATTACK_RANGE_TILES - 0.5),
            y: clickedMob.pos.y - (ddy / len) * (ATTACK_RANGE_TILES - 0.5),
          },
        };
        ws.send(JSON.stringify(move));
        // Also fire an attack; server will reject if out of range, harmless.
        const atk: ClientMessage = { type: 'attack', targetId: clickedMob.id };
        ws.send(JSON.stringify(atk));
      } else {
        const atk: ClientMessage = { type: 'attack', targetId: clickedMob.id };
        ws.send(JSON.stringify(atk));
      }
    } else {
      const move: ClientMessage = { type: 'move', target: tile };
      ws.send(JSON.stringify(move));
    }
  });

  // ─── Render loop ────────────────────────────────────────────────

  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    const lerpRate = 12; // higher = snappier convergence

    // Reconcile / lerp player positions.
    const seenPlayers = new Set<string>();
    for (const p of serverPlayers) {
      seenPlayers.add(p.id);
      let render = renderPlayerPos.get(p.id);
      if (!render) {
        render = { ...p.pos };
        renderPlayerPos.set(p.id, render);
      }
      const k = 1 - Math.exp(-lerpRate * dt);
      render.x += (p.pos.x - render.x) * k;
      render.y += (p.pos.y - render.y) * k;

      // Sprite.
      let entry = playerSprites.get(p.id);
      if (!entry) {
        entry = makePlayerSprite(p.name, p.id === myId);
        playerSprites.set(p.id, entry);
        entityLayer.addChild(entry.container);
      }
      const s = tileToScreen(render);
      entry.container.x = s.x;
      entry.container.y = s.y;
      drawHpBar(entry.hpBar, p.hp, p.maxHp);
      // depth-sort by y so closer entities draw on top
      entry.container.zIndex = render.y;
    }
    // Remove sprites for players no longer present.
    for (const [id, entry] of playerSprites) {
      if (!seenPlayers.has(id)) {
        entityLayer.removeChild(entry.container);
        playerSprites.delete(id);
        renderPlayerPos.delete(id);
      }
    }

    // Mobs.
    const seenMobs = new Set<string>();
    for (const m of serverMobs) {
      seenMobs.add(m.id);
      let render = renderMobPos.get(m.id);
      if (!render) {
        render = { ...m.pos };
        renderMobPos.set(m.id, render);
      }
      const k = 1 - Math.exp(-lerpRate * dt);
      render.x += (m.pos.x - render.x) * k;
      render.y += (m.pos.y - render.y) * k;

      let entry = mobSprites.get(m.id);
      if (!entry) {
        entry = makeMobSprite();
        mobSprites.set(m.id, entry);
        entityLayer.addChild(entry.container);
      }
      const s = tileToScreen(render);
      entry.container.x = s.x;
      entry.container.y = s.y;
      entry.container.alpha = m.alive ? 1 : 0.25;
      entry.container.eventMode = m.alive ? 'static' : 'none';
      drawHpBar(entry.hpBar, m.hp, m.maxHp, 36);
      entry.container.zIndex = render.y;
    }
    for (const [id, entry] of mobSprites) {
      if (!seenMobs.has(id)) {
        entityLayer.removeChild(entry.container);
        mobSprites.delete(id);
        renderMobPos.delete(id);
      }
    }

    // Floaters.
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i]!;
      f.text.y += f.vy;
      f.life -= dt;
      f.text.alpha = Math.max(0, f.life);
      if (f.life <= 0) {
        entityLayer.removeChild(f.text);
        floaters.splice(i, 1);
      }
    }

    entityLayer.sortableChildren = true;
    entityLayer.sortChildren();
  });
})().catch((err) => {
  console.error(err);
  setStatus(`error: ${(err as Error).message}`);
});
