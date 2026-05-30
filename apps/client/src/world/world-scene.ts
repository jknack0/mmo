// PixiJS-backed iso-world scene. Composes the terrain, entity, mob, and
// input layers, drives them from a ChannelClient + SnapshotInterpolator.
// Single public entry: `mountWorldScene(container, opts) → cleanup`.

import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TextureSource,
} from 'pixi.js';
import type { ServerMessage, Vec2, GroundItem } from '@mmo/protocol';
import { getItemBase, RARITY_COLOR, type Rarity } from '@mmo/domain';
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
  /** Called every frame with the local player's live stats for HUD rendering. */
  onStats?: (s: LocalPlayerStats) => void;
  /** Called when the server confirms a loot pickup (so the bag can refresh). */
  onPickup?: (baseId: string) => void;
}

export interface LocalPlayerStats {
  spirit: number;
  maxSpirit: number;
  wrath: number;
  maxWrath: number;
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

  // Pixel-art crispness: nearest-neighbor everywhere, no smoothing.
  TextureSource.defaultOptions.scaleMode = 'nearest';

  // Load the 8-direction sprite sheets and slice them into frame textures.
  // Frame order is always [e, se, s, sw, w, nw, n, ne] per the handoff.
  function slice8(src: Texture, w: number, h: number): Texture[] {
    src.source.scaleMode = 'nearest';
    return Array.from(
      { length: 8 },
      (_, i) => new Texture({ source: src.source, frame: new Rectangle(i * w, 0, w, h) })
    );
  }
  const [heroSheet, skelSheet] = await Promise.all([
    Assets.load('/assets/hero_pyromancer_idle_8dir.png') as Promise<Texture>,
    Assets.load('/assets/mob_skeleton_base.png') as Promise<Texture>,
  ]);
  const HERO_FRAMES = slice8(heroSheet, 16, 21);
  const SKEL_FRAMES = slice8(skelSheet, 16, 19);
  const SPRITE_SCALE = 2;
  const SOUTH = 2; // default facing toward camera

  /** Screen-space movement angle → 8-dir frame index [e,se,s,sw,w,nw,n,ne]. */
  function facingFromDelta(dx: number, dy: number): number {
    const sdx = (dx - dy) * (ISO_TILE_W / 2);
    const sdy = (dx + dy) * (ISO_TILE_H / 2);
    const deg = (Math.atan2(sdy, sdx) * 180) / Math.PI;
    return ((Math.round(deg / 45) % 8) + 8) % 8;
  }

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
  const groundLayer = new Container();
  const entityLayer = new Container();
  entityLayer.sortableChildren = true;
  const floaterLayer = new Container();
  world.addChild(terrainLayer, groundLayer, entityLayer, floaterLayer);

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
  interface PlayerSpriteEntry {
    container: Container;
    body: Sprite;
    facing: number;
    lastPos: Vec2;
  }
  interface MobSpriteEntry {
    container: Container;
    hpBar: Graphics;
    body: Sprite;
    /** Yellow target ring drawn underfoot when the local player is sticky-targeting this mob. */
    targetRing: Graphics;
  }
  const playerSprites = new Map<string, PlayerSpriteEntry>();
  const mobSprites = new Map<string, MobSpriteEntry>();

  // ─── Ground items (S13) ────────────────────────────────────────
  const groundSprites = new Map<string, Container>();
  let latestGroundItems: GroundItem[] = [];
  /** Items we've already sent a pickup for, so walk-over doesn't spam. */
  const requestedPickups = new Set<string>();
  const PICKUP_TILE_RADIUS = 1.2;

  function makeGroundSprite(baseId: string, rarity: string): Container {
    const c = new Container();
    c.eventMode = 'static';
    c.cursor = 'pointer';
    // Constant rarity color (CONTEXT glossary) — never the zone palette.
    const color = Number.parseInt(
      (RARITY_COLOR[rarity as Rarity] ?? '#ffe08a').slice(1),
      16
    );
    const gem = new Graphics()
      .poly([0, -7, 6, 0, 0, 7, -6, 0])
      .fill({ color })
      .stroke({ color: 0x1a1208, width: 1.5 });
    const label = new Text({
      text: getItemBase(baseId)?.name ?? baseId,
      style: { fontSize: 9, fill: color, stroke: { color: 0x000000, width: 3 } },
    });
    label.anchor.set(0.5, 1);
    label.y = -10;
    c.addChild(gem, label);
    return c;
  }
  // mobId → { x, y } in tile coords, kept fresh from latest render frame
  // so damage floaters can spawn at the mob's last seen position even
  // after a fatal hit collapses the entry on the next snapshot.
  const lastMobPos = new Map<string, Vec2>();

  function makePlayerSprite(name: string, isMe: boolean): PlayerSpriteEntry {
    const container = new Container();
    const feet = new Graphics()
      .ellipse(0, 1, 9, 4)
      .fill({ color: 0x000000, alpha: 0.4 });
    const body = new Sprite(HERO_FRAMES[SOUTH]);
    body.anchor.set(0.5, 0.95); // feet-anchored
    body.scale.set(SPRITE_SCALE);
    if (!isMe) body.tint = 0xc9d6ff; // tint other players cool so "me" reads warm
    const label = new Text({
      text: name,
      style: { fontSize: 11, fill: 0xf0deba, stroke: { color: 0x000000, width: 3 } },
    });
    label.anchor.set(0.5, 1);
    label.y = -46;
    container.addChild(feet, body, label);
    return { container, body, facing: SOUTH, lastPos: { x: 0, y: 0 } };
  }

  function makeMobSprite(kind: string): MobSpriteEntry {
    const container = new Container();
    container.eventMode = 'static';
    container.cursor = 'crosshair';
    const targetRing = new Graphics();
    targetRing.visible = false;
    const feet = new Graphics()
      .ellipse(0, 1, 10, 4)
      .fill({ color: 0x000000, alpha: 0.5 });
    const body = new Sprite(SKEL_FRAMES[SOUTH]);
    body.anchor.set(0.5, 0.95);
    body.scale.set(SPRITE_SCALE);
    const label = new Text({
      text: kind,
      style: { fontSize: 10, fill: 0xd8cdbb, stroke: { color: 0x000000, width: 3 } },
    });
    label.anchor.set(0.5, 1);
    label.y = -44;
    const hpBar = new Graphics();
    hpBar.y = -42;
    container.addChild(targetRing, feet, body, label, hpBar);
    return { container, hpBar, body, targetRing };
  }

  function drawTargetRing(ring: Graphics): void {
    ring.clear();
    ring
      .ellipse(0, 2, 16, 7)
      .stroke({ color: 0xffd24a, width: 2 });
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
        latestGroundItems = msg.snapshot.groundItems ?? [];
        break;
      case 'picked-up':
        requestedPickups.delete(msg.itemId);
        opts.onPickup?.(msg.baseId);
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
    // Loot takes click priority: if a ground item is near the click, grab it.
    {
      let bestItem: GroundItem | null = null;
      let bestItemDist = 1.5;
      for (const gi of latestGroundItems) {
        const d = Math.hypot(gi.pos.x - clicked.x, gi.pos.y - clicked.y);
        if (d < bestItemDist) {
          bestItemDist = d;
          bestItem = gi;
        }
      }
      if (bestItem) {
        client.send({ type: 'pickup', itemId: bestItem.id });
        return;
      }
    }
    // Pick the closest alive mob within a generous tile radius. The mob's
    // sprite body sits ~22px above its tile centre, so clicking on the
    // visible mob lands a tile or two "above" its actual position in iso
    // projection — the radius has to be loose enough to absorb that.
    let bestMob: InterpolatedMobState | null = null;
    let bestDist = 2.2;
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

  // ─── 6-slot hotbar ──────────────────────────────────────────
  // Per ADR-0003 (amended) the alpha hotbar has 6 keys. Hardcoded loadout
  // showcases both Pyromancy sub-archetypes (burn-stacker via cinder-spray
  // → combust; direct-burst via spark / fireball / meteor / pyroclasm).
  // Configurable bindings + drag-bind UI land in S09 (#11) with tripods.
  const SKILL_KEYBINDS: Record<string, string> = {
    q: 'spark',
    w: 'cinder-spray',
    e: 'fireball',
    r: 'pyroclasm',
    a: 'combust',
    s: 'meteor',
  };
  function castSkillByHotkey(skillId: string): void {
    if (!myId) return;
    const me = lastFrame.players.find((p) => p.id === myId);
    if (!me) return;
    let targetId = me.engagedTargetId ?? null;
    if (!targetId) {
      // Pick the nearest alive mob — server will reject if out of range.
      let bestDist = Infinity;
      for (const mob of aliveMobsByTile.values()) {
        const dx = mob.pos.x - me.pos.x;
        const dy = mob.pos.y - me.pos.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestDist) {
          bestDist = d;
          targetId = mob.id;
        }
      }
    }
    if (!targetId) return;
    client.send({ type: 'attack', targetId, skillId });
  }
  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      e.preventDefault();
      client.send({ type: 'dodge' });
      return;
    }
    const skill = SKILL_KEYBINDS[e.key.toLowerCase()];
    if (skill) castSkillByHotkey(skill);
  }
  window.addEventListener('keydown', onKeyDown);

  // Frame cache so hotkey handlers don't need to re-run the interpolator.
  let lastFrame: ReturnType<typeof interp.interpolate> = { players: [], mobs: [] };

  // ─── Render loop ──────────────────────────────────────────────
  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    const frame = interp.interpolate(dt);
    lastFrame = frame;

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
      // Face the direction of travel; hold facing when standing still.
      const ddx = p.pos.x - entry.lastPos.x;
      const ddy = p.pos.y - entry.lastPos.y;
      if (Math.abs(ddx) + Math.abs(ddy) > 0.003) {
        const idx = facingFromDelta(ddx, ddy);
        if (idx !== entry.facing) {
          entry.facing = idx;
          entry.body.texture = HERO_FRAMES[idx]!;
        }
      }
      entry.lastPos = { x: p.pos.x, y: p.pos.y };
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
    const myEngagedId =
      myId != null
        ? frame.players.find((p) => p.id === myId)?.engagedTargetId ?? null
        : null;
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
      const targeted = m.id === myEngagedId && m.alive;
      entry.targetRing.visible = targeted;
      if (targeted) drawTargetRing(entry.targetRing);
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

    // Ground items — sync sprites + walk-over auto-pickup.
    const seenG = new Set<string>();
    const me = myId != null ? frame.players.find((p) => p.id === myId) : undefined;
    for (const gi of latestGroundItems) {
      seenG.add(gi.id);
      let sprite = groundSprites.get(gi.id);
      if (!sprite) {
        sprite = makeGroundSprite(gi.baseId, gi.rarity);
        sprite.on('pointerdown', (e) => {
          e.stopPropagation();
          client.send({ type: 'pickup', itemId: gi.id });
        });
        groundSprites.set(gi.id, sprite);
        groundLayer.addChild(sprite);
      }
      const s = tileToScreen(gi.pos);
      sprite.x = s.x;
      sprite.y = s.y;
      // Walk-over pickup: send once when the local player steps close.
      if (me && !requestedPickups.has(gi.id)) {
        if (Math.hypot(gi.pos.x - me.pos.x, gi.pos.y - me.pos.y) <= PICKUP_TILE_RADIUS) {
          requestedPickups.add(gi.id);
          client.send({ type: 'pickup', itemId: gi.id });
        }
      }
    }
    for (const [id, sprite] of groundSprites) {
      if (!seenG.has(id)) {
        groundLayer.removeChild(sprite);
        groundSprites.delete(id);
      }
    }

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
    window.removeEventListener('keydown', onKeyDown);
    app.destroy(true, { children: true });
  };
}
