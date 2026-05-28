// PixiJS-backed iso-world scene. Composes the terrain, entity, mob, and
// input layers, drives them from a ChannelClient + SnapshotInterpolator.
// Single public entry: `mountWorldScene(container, opts) → cleanup`.

import { Application, Container, Graphics, Text } from 'pixi.js';
import type { ServerMessage, Vec2 } from '@mmo/protocol';
import { createChannelClient, type ChannelClient } from '../network/channel-client.js';
import {
  createSnapshotInterpolator,
  type InterpolatedMobState,
} from '../network/snapshot-interpolator.js';
import { tileToScreen, screenToTile, ISO_TILE_W, ISO_TILE_H } from './iso-coords.js';

export interface MountWorldSceneOptions {
  container: HTMLElement;
  wsUrl: string;
  sessionToken: string;
  characterId: string;
  characterName: string;
  onDisconnected?: () => void;
}

export type WorldSceneCleanup = () => void;

interface Floater {
  text: Text;
  life: number;
  vy: number;
}

export async function mountWorldScene(
  opts: MountWorldSceneOptions
): Promise<WorldSceneCleanup> {
  const app = new Application();
  await app.init({
    background: '#0d0d12',
    resizeTo: opts.container,
    antialias: true,
  });
  opts.container.appendChild(app.canvas);

  const world = new Container();
  app.stage.addChild(world);

  function recenter(): void {
    world.x = app.screen.width / 2;
    world.y = app.screen.height / 5;
  }
  recenter();
  const onResize = () => recenter();
  window.addEventListener('resize', onResize);

  const terrainLayer = new Container();
  const entityLayer = new Container();
  entityLayer.sortableChildren = true;
  const floaterLayer = new Container();
  world.addChild(terrainLayer, entityLayer, floaterLayer);

  function drawTerrain(zoneSize: Vec2, tileMap: number[][]): void {
    terrainLayer.removeChildren();
    for (let y = 0; y < zoneSize.y; y++) {
      for (let x = 0; x < zoneSize.x; x++) {
        const screen = tileToScreen({ x, y });
        const tile = new Graphics();
        const blocked = tileMap[y]?.[x] === 1;
        const shade = blocked ? 0x2a1a1a : (x + y) % 2 === 0 ? 0x2e3a30 : 0x28342a;
        tile
          .poly([
            0, -ISO_TILE_H / 2,
            ISO_TILE_W / 2, 0,
            0, ISO_TILE_H / 2,
            -ISO_TILE_W / 2, 0,
          ])
          .fill(shade)
          .stroke({ color: 0x1a1a1f, width: 1 });
        tile.x = screen.x;
        tile.y = screen.y;
        terrainLayer.addChild(tile);
      }
    }
  }

  // ─── Sprite entries ────────────────────────────────────────────
  interface PlayerSpriteEntry { container: Container; }
  interface MobSpriteEntry { container: Container; hpBar: Graphics; body: Graphics; }
  const playerSprites = new Map<string, PlayerSpriteEntry>();
  const mobSprites = new Map<string, MobSpriteEntry>();
  // mobId → { x, y } in tile coords, kept fresh from latest render frame
  // so damage floaters can spawn at the mob's last seen position even
  // after a fatal hit collapses the entry on the next snapshot.
  const lastMobPos = new Map<string, Vec2>();

  function makePlayerSprite(name: string, isMe: boolean): PlayerSpriteEntry {
    const container = new Container();
    const feet = new Graphics()
      .ellipse(0, 0, 10, 4)
      .fill({ color: 0x000000, alpha: 0.4 });
    const body = new Graphics()
      .circle(0, -12, 10)
      .fill(isMe ? 0x6ab0ff : 0xff8a6a)
      .stroke({ color: 0x000000, width: 1 });
    const label = new Text({
      text: name,
      style: {
        fontSize: 11,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
      },
    });
    label.anchor.set(0.5, 1);
    label.y = -28;
    container.addChild(feet, body, label);
    return { container };
  }

  function makeMobSprite(kind: string): MobSpriteEntry {
    const container = new Container();
    container.eventMode = 'static';
    container.cursor = 'crosshair';
    const feet = new Graphics()
      .ellipse(0, 0, 12, 5)
      .fill({ color: 0x000000, alpha: 0.5 });
    const body = new Graphics()
      .roundRect(-8, -22, 16, 22, 3)
      .fill(0xc8c8c8)
      .stroke({ color: 0x000000, width: 1 });
    const label = new Text({
      text: kind,
      style: {
        fontSize: 10,
        fill: 0xdddddd,
        stroke: { color: 0x000000, width: 3 },
      },
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

  // ─── Damage floaters ──────────────────────────────────────────
  const floaters: Floater[] = [];

  function spawnFloater(atTile: Vec2, text: string, color: number, isFatal: boolean): void {
    const t = new Text({
      text,
      style: {
        fontSize: isFatal ? 18 : 14,
        fill: color,
        stroke: { color: 0x000000, width: 3 },
        fontWeight: 'bold',
      },
    });
    t.anchor.set(0.5);
    const screen = tileToScreen(atTile);
    t.x = screen.x;
    t.y = screen.y - 30;
    floaterLayer.addChild(t);
    floaters.push({ text: t, life: 1.0, vy: -0.7 });
  }

  // ─── Channel client + interpolator ────────────────────────────
  const client: ChannelClient = createChannelClient({ wsUrl: opts.wsUrl });
  const interp = createSnapshotInterpolator({ lerpRate: 12 });
  let myId: string | null = null;
  let zoneSize: Vec2 = { x: 30, y: 30 };

  // Expose the last known set of mob ids/positions so the InputController
  // can decide whether a click hit a mob.
  const aliveMobsByTile = new Map<string, InterpolatedMobState>();

  function handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        myId = msg.you;
        zoneSize = msg.zoneSize;
        drawTerrain(zoneSize, msg.tileMap);
        break;
      case 'snapshot':
        interp.ingest(msg.snapshot);
        break;
      case 'damage': {
        const pos = lastMobPos.get(msg.event.targetId);
        if (pos) {
          spawnFloater(
            pos,
            msg.event.fatal ? `KILL` : `-${msg.event.amount}`,
            msg.event.fatal ? 0xff5555 : 0xffcc66,
            msg.event.fatal
          );
        }
        break;
      }
      case 'error':
        console.warn('[channel] error:', msg.reason);
        break;
    }
  }

  const unsubMsg = client.onMessage(handleServerMessage);
  const unsubStatus = client.onStatusChange((s) => {
    if (s === 'open') {
      client.send({
        type: 'hello',
        sessionToken: opts.sessionToken,
        characterId: opts.characterId,
        name: opts.characterName,
      });
    } else if (s === 'closed') {
      opts.onDisconnected?.();
    }
  });

  // ─── Input: click-to-move / click-on-mob to attack ──────────
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.on('pointerdown', (e) => {
    const wx = e.global.x - world.x;
    const wy = e.global.y - world.y;
    const clicked = screenToTile({ x: wx, y: wy });
    if (
      clicked.x < 0 ||
      clicked.y < 0 ||
      clicked.x > zoneSize.x - 1 ||
      clicked.y > zoneSize.y - 1
    ) {
      return;
    }
    // Check if any alive mob is within ~0.7 tile radius of the click.
    let bestMob: InterpolatedMobState | null = null;
    let bestDist = 0.7;
    for (const mob of aliveMobsByTile.values()) {
      const dx = mob.pos.x - clicked.x;
      const dy = mob.pos.y - clicked.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        bestDist = d;
        bestMob = mob;
      }
    }
    if (bestMob) {
      client.send({
        type: 'attack',
        targetId: bestMob.id,
        skillId: 'basic-attack',
      });
    } else {
      client.send({ type: 'move', target: clicked });
    }
  });

  // ─── Render loop ──────────────────────────────────────────────
  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    const frame = interp.interpolate(dt);

    // Players
    const seenP = new Set<string>();
    for (const p of frame.players) {
      seenP.add(p.id);
      let entry = playerSprites.get(p.id);
      if (!entry) {
        entry = makePlayerSprite(p.name, p.id === myId);
        playerSprites.set(p.id, entry);
        entityLayer.addChild(entry.container);
      }
      const s = tileToScreen(p.pos);
      entry.container.x = s.x;
      entry.container.y = s.y;
      entry.container.zIndex = p.pos.y;
    }
    for (const [id, entry] of playerSprites) {
      if (!seenP.has(id)) {
        entityLayer.removeChild(entry.container);
        playerSprites.delete(id);
      }
    }

    // Mobs
    aliveMobsByTile.clear();
    const seenM = new Set<string>();
    for (const m of frame.mobs) {
      seenM.add(m.id);
      lastMobPos.set(m.id, { x: m.pos.x, y: m.pos.y });
      if (m.alive) aliveMobsByTile.set(m.id, m);
      let entry = mobSprites.get(m.id);
      if (!entry) {
        entry = makeMobSprite(m.kind);
        mobSprites.set(m.id, entry);
        entityLayer.addChild(entry.container);
      }
      const s = tileToScreen(m.pos);
      entry.container.x = s.x;
      entry.container.y = s.y;
      entry.container.alpha = m.alive ? 1 : 0.25;
      drawHpBar(entry.hpBar, m.hp, m.maxHp, 36);
      entry.container.zIndex = m.pos.y;
    }
    for (const [id, entry] of mobSprites) {
      if (!seenM.has(id)) {
        entityLayer.removeChild(entry.container);
        mobSprites.delete(id);
        lastMobPos.delete(id);
      }
    }

    entityLayer.sortChildren();

    // Floaters
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i]!;
      f.text.y += f.vy;
      f.life -= dt;
      f.text.alpha = Math.max(0, f.life);
      if (f.life <= 0) {
        floaterLayer.removeChild(f.text);
        floaters.splice(i, 1);
      }
    }
  });

  return () => {
    unsubMsg();
    unsubStatus();
    client.close();
    window.removeEventListener('resize', onResize);
    app.destroy(true, { children: true });
  };
}
