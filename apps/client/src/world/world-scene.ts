// PixiJS-backed iso-world scene. Composes the terrain, entity, mob, and
// input layers, drives them from a ChannelClient + SnapshotInterpolator.
// Single public entry: `mountWorldScene(container, opts) → cleanup`.

import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextureSource,
} from 'pixi.js';
import type { ServerMessage, Vec2, GroundItem } from '@mmo/protocol';
import { createSnapshotReconstructor } from '@mmo/protocol';
import { loadAssetRegistry } from './asset-registry.js';
import {
  PLAYER_SHEET,
  FACING_SOUTH,
  clipFrameIndex,
  type ClipState,
  type SheetMeta,
} from './asset-manifest.js';
import type { Texture } from 'pixi.js';
import { HOTBAR, canCast, hotbarView, type HotbarSlotView } from './hotbar.js';
import { getItemBase, RARITY_COLOR, type Rarity } from '@mmo/domain';
import { createChannelClient, type ChannelClient } from '../network/channel-client.js';
import {
  createSnapshotInterpolator,
  type InterpolatedMobState,
} from '../network/snapshot-interpolator.js';
import { tileToScreen, screenToTile, ISO_TILE_W, ISO_TILE_H } from './iso-coords.js';
import { RIFT_T1 } from '@mmo/domain';
import { fx, SKILL_GLYPH } from './fx.js';

export interface MountWorldSceneOptions {
  container: HTMLElement;
  wsUrl: string;
  sessionToken: string;
  characterId: string;
  characterName: string;
  onDisconnected?: () => void;
  /** Called every frame with the local player's live stats for HUD rendering. */
  onStats?: (s: LocalPlayerStats) => void;
  /** Called every frame with the hotbar's cooldown/castability state per slot. */
  onHotbar?: (slots: HotbarSlotView[]) => void;
  /** Called when the server confirms a loot pickup (so the bag can refresh). */
  onPickup?: (baseId: string) => void;
  /** Called when the server confirms a consumable was used (so the bag refreshes). */
  onConsumed?: (itemId: string) => void;
  /** Hands the parent a handle to drive the in-world player (e.g. use a potion). */
  onControls?: (controls: WorldSceneControls) => void;
  /** Player stepped on a portal — the parent reconnects to the target zone. */
  onZoneTransition?: (zoneId: string) => void;
  /** Local player's HP hit 0 — the parent shows the death screen. */
  onDeath?: () => void;
  /** Rift phase/progress update (S19/S20), for the objective banner. */
  onRiftStatus?: (s: { phase: string; kills: number; quota: number; deaths: number; maxDeaths: number }) => void;
  /** A trainer NPC was clicked (S12) — the parent opens the quest dialog. */
  onTrainerClick?: (npcId: string) => void;
  /** A mob just died this frame (S12) — drives trainer-quest kill progress. */
  onMobKilled?: (kind: string) => void;
}

export interface WorldSceneControls {
  /** Send a use-item (consume) request to the channel for the given item. */
  useItem: (itemId: string) => void;
  /** Walk toward a tile (S26 e2e driver — deterministic, no canvas clicks). */
  move: (target: Vec2) => void;
  /** Engage a mob with a skill (S26 e2e driver). */
  attack: (mobId: string, skillId: string) => void;
  /** Cast a hotbar skill (auto-targets nearest if nothing engaged). Returns
   *  false if it was on cooldown / unaffordable / had no target. */
  castSkill: (skillId: string) => boolean;
  /** Snapshot the live world for assertions (S26 e2e driver). */
  getState: () => {
    myId: string | null;
    me: { pos: Vec2; hp: number } | null;
    mobs: Array<{ id: string; pos: Vec2; hp: number; alive: boolean }>;
    ground: Array<{ id: string; baseId: string; pos: Vec2 }>;
  };
}

export interface LocalPlayerStats {
  spirit: number;
  maxSpirit: number;
  wrath: number;
  maxWrath: number;
  hp: number;
  maxHp: number;
}

export type WorldSceneCleanup = () => void;

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

  // Sprites come from the manifest-driven asset registry (asset-registry.ts):
  // every sheet declared in spritesheet_map.json is loaded + sliced, with a
  // tinted placeholder for any sheet that hasn't been authored yet. Frame order
  // is always [e, se, s, sw, w, nw, n, ne].
  const assets = await loadAssetRegistry();
  const HERO_FRAMES = assets.playerFrames();
  const heroMeta = assets.meta(PLAYER_SHEET);
  const HERO_SCALE = heroMeta?.renderScale ?? 2;
  const HERO_ANCHOR = heroMeta?.anchor ?? [0.5, 0.95];
  const SOUTH = FACING_SOUTH; // default facing toward camera

  /** Screen-space movement angle → 8-dir frame index [e,se,s,sw,w,nw,n,ne]. */
  function facingFromDelta(dx: number, dy: number): number {
    const sdx = (dx - dy) * (ISO_TILE_W / 2);
    const sdy = (dx + dy) * (ISO_TILE_H / 2);
    const deg = (Math.atan2(sdy, sdx) * 180) / Math.PI;
    return ((Math.round(deg / 45) % 8) + 8) % 8;
  }

  // ─── Per-actor animation (S-anim) ──────────────────────────────
  // Any sprite that walks/idles carries its sliced sheet + a clip cursor.
  // The clip model lives in asset-manifest (clipFrameIndex); the renderer just
  // advances time and picks the texture. Legacy sheets (no clips) collapse to a
  // static facing frame, so un-reauthored actors render exactly as before.
  const MOVE_EPS = 0.003; // tile-space delta below which an actor is "standing still"
  interface AnimActor {
    body: Sprite;
    frames: Texture[];
    meta?: SheetMeta;
    facing: number;
    state: ClipState;
    clipElapsed: number; // ms into the current clip (reset on state change)
    lastPos: Vec2;
  }

  /** Advance an actor's clip by `dtMs`, pick facing from motion, set its frame. */
  function animateActor(a: AnimActor, pos: Vec2, dtMs: number): void {
    const ddx = pos.x - a.lastPos.x;
    const ddy = pos.y - a.lastPos.y;
    const moving = Math.abs(ddx) + Math.abs(ddy) > MOVE_EPS;
    if (moving) a.facing = facingFromDelta(ddx, ddy); // hold facing when still
    const next: ClipState = moving ? 'move' : 'idle';
    if (next !== a.state) {
      a.state = next;
      a.clipElapsed = 0;
    } else {
      a.clipElapsed += dtMs;
    }
    a.lastPos = { x: pos.x, y: pos.y };
    if (a.frames.length === 0) return;
    const idx = a.meta
      ? clipFrameIndex(a.meta, a.state, a.facing, a.clipElapsed)
      : Math.min(a.facing, a.frames.length - 1); // no manifest meta → best-effort facing
    a.body.texture = a.frames[idx] ?? a.frames[0]!;
  }

  const world = new Container();
  app.stage.addChild(world);

  let worldBaseX = 0;
  let worldBaseY = 0;
  function recenter(): void {
    worldBaseX = app.screen.width / 2;
    worldBaseY = app.screen.height / 5;
    world.x = worldBaseX;
    world.y = worldBaseY;
  }
  recenter();
  const onResize = () => {
    recenter();
    sizeFxCanvas();
  };
  window.addEventListener('resize', onResize);

  const terrainLayer = new Container();
  const decorLayer = new Container(); // static NPCs + zone portals (S17)
  const groundLayer = new Container();
  const entityLayer = new Container();
  entityLayer.sortableChildren = true;
  world.addChild(terrainLayer, decorLayer, groundLayer, entityLayer);

  // ─── Pyromancy FX engine (Claude-Design canvas overlay) ────────
  // The vendored fx engine renders in screen px on a 2D canvas layered over the
  // Pixi WebGL canvas; we map world tiles → screen px through the world offset.
  const fxCanvas = document.createElement('canvas');
  fxCanvas.style.position = 'absolute';
  fxCanvas.style.inset = '0';
  fxCanvas.style.pointerEvents = 'none';
  fxCanvas.style.imageRendering = 'pixelated';
  opts.container.appendChild(fxCanvas);
  const fxCtx = fxCanvas.getContext('2d')!;
  function sizeFxCanvas(): void {
    fxCanvas.width = opts.container.clientWidth;
    fxCanvas.height = opts.container.clientHeight;
    fx.seedEmbers(fxCanvas.width, fxCanvas.height);
  }
  sizeFxCanvas();
  // Meteor screen-shake jitters the world container briefly.
  let shakeT = 0;
  (window as unknown as { MMO: { shake: (n: number) => void } }).MMO.shake = (n: number) => {
    shakeT = Math.max(shakeT, Math.min(0.4, n / 25));
  };
  /** Tile coords → fx screen px (includes the world container offset). */
  function tileToFx(tile: Vec2): { x: number; y: number } {
    const s = tileToScreen(tile);
    return { x: world.x + s.x, y: world.y + s.y - 16 };
  }

  // Deterministic per-tile noise (no flicker between redraws).
  function tileHash(x: number, y: number): number {
    let h = (x * 374761393 + y * 668265263) >>> 0;
    h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
    return (h >>> 0) / 4294967296;
  }

  function drawTerrain(zoneSize: Vec2, tileMap: number[][]): void {
    terrainLayer.removeChildren();
    const hw = ISO_TILE_W / 2; // 32
    const hh = ISO_TILE_H / 2; // 16
    const diamond = [0, -hh, hw, 0, 0, hh, -hw, 0];
    for (let y = 0; y < zoneSize.y; y++) {
      for (let x = 0; x < zoneSize.x; x++) {
        const screen = tileToScreen({ x, y });
        const tile = new Graphics();
        const blocked = tileMap[y]?.[x] === 1;
        const r = tileHash(x, y);

        const base = blocked ? 0x2a1a1a : (x + y) % 2 === 0 ? 0x2e3a30 : 0x28342a;
        const darkEdge = blocked ? 0x140d0d : 0x1a2019;
        const litEdge = blocked ? 0x3a2622 : 0x44523c;

        // Top face.
        tile.poly(diamond).fill(base);
        // Pixel bevel: lit upper-left edges, shadowed lower-right edges.
        tile.moveTo(-hw, 0).lineTo(0, -hh).lineTo(hw, 0).stroke({ color: litEdge, width: 1 });
        tile.moveTo(hw, 0).lineTo(0, hh).lineTo(-hw, 0).stroke({ color: darkEdge, width: 2 });

        // Speckle texture — a few hashed pixels of darker/lighter dirt.
        const speckN = 2 + Math.floor(r * 3);
        for (let i = 0; i < speckN; i++) {
          const rr = tileHash(x * 7 + i, y * 13 + i);
          const sx = Math.round((rr - 0.5) * hw);
          const sy = Math.round((tileHash(x + i, y * 3 - i) - 0.5) * hh);
          if (Math.abs(sx) / hw + Math.abs(sy) / hh > 0.78) continue; // keep inside
          tile.rect(sx, sy, 2, 2).fill(rr > 0.5 ? litEdge : darkEdge);
        }

        if (blocked) {
          // Charred rock outcrop: a raised top highlight + a couple cracks.
          tile.rect(-6, -6, 4, 2).fill(0x4a342e);
          tile.rect(2, -2, 3, 2).fill(0x1a1212);
        } else if (r < 0.08) {
          // Ember crack glowing through the ash.
          tile.rect(-3, 1, 5, 1).fill(0xb0301a);
          tile.rect(0, 0, 2, 1).fill(0xff9f1a);
        }

        tile.x = screen.x;
        tile.y = screen.y;
        terrainLayer.addChild(tile);
      }
    }
  }

  // ─── Static decor: town NPCs + zone portals (S17) ──────────────
  function decorMarker(kind: string, label: string): Container {
    const c = new Container();
    const isPortal = kind === 'portal' || kind === 'rift-portal';
    const tint = isPortal ? 0x4ad0ff : kind === 'vendor' ? 0xffd24a : kind === 'trainer' ? 0xff8a6a : 0x9fd2ff;
    const g = new Graphics();
    if (isPortal) {
      // A glowing portal ring on the ground.
      g.ellipse(0, 0, 22, 11).fill({ color: tint, alpha: 0.18 }).stroke({ color: tint, width: 3 });
      g.ellipse(0, 0, 13, 6).stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
    } else {
      // An NPC stands as a small pillar with a base shadow.
      g.ellipse(0, 2, 12, 6).fill({ color: 0x000000, alpha: 0.35 });
      g.roundRect(-7, -28, 14, 28, 3).fill(tint).stroke({ color: 0x1a1410, width: 2 });
    }
    const text = new Text({
      text: label,
      style: { fontFamily: 'monospace', fontSize: 11, fill: tint, stroke: { color: 0x000000, width: 3 } },
    });
    text.anchor.set(0.5, 1);
    text.y = isPortal ? -16 : -34;
    c.addChild(g, text);
    return c;
  }

  function drawDecor(npcsList: { id: string; kind: string; pos: Vec2; label: string }[], portalsList: { pos: Vec2; label: string }[]): void {
    decorLayer.removeChildren();
    for (const p of portalsList) {
      const m = decorMarker('portal', p.label);
      const s = tileToScreen(p.pos);
      m.x = s.x;
      m.y = s.y;
      decorLayer.addChild(m);
    }
    for (const n of npcsList) {
      const m = decorMarker(n.kind, n.label);
      const s = tileToScreen(n.pos);
      m.x = s.x;
      m.y = s.y;
      // The Rift portal NPC is interactive — click it to enter a fresh Rift (S19).
      if (n.kind === 'rift-portal') {
        m.eventMode = 'static';
        m.cursor = 'pointer';
        m.hitArea = new Rectangle(-24, -24, 48, 48);
        m.on('pointerdown', (e) => {
          e.stopPropagation();
          opts.onZoneTransition?.(RIFT_T1);
        });
      }
      // Trainer NPCs are interactive — click to open the learn-discipline quest (S12).
      if (n.kind === 'trainer') {
        const npcId = n.id;
        m.eventMode = 'static';
        m.cursor = 'pointer';
        m.hitArea = new Rectangle(-24, -24, 48, 48);
        m.on('pointerdown', (e) => {
          e.stopPropagation();
          opts.onTrainerClick?.(npcId);
        });
      }
      decorLayer.addChild(m);
    }
  }

  // ─── Sprite entries ────────────────────────────────────────────
  interface PlayerSpriteEntry extends AnimActor {
    container: Container;
  }
  interface MobSpriteEntry extends AnimActor {
    container: Container;
    hpBar: Graphics;
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
    const beacon = new Graphics();
    // Ground ring.
    beacon.ellipse(0, 3, 11, 5).fill({ color, alpha: 0.14 });
    beacon.ellipse(0, 3, 11, 5).stroke({ color, alpha: 0.55, width: 1 });
    // Vertical light beam (wide faint + bright core).
    beacon.rect(-4, -24, 8, 27).fill({ color, alpha: 0.1 });
    beacon.rect(-1, -22, 2, 25).fill({ color, alpha: 0.32 });
    // Pixel gem.
    beacon.poly([0, -9, 5, -3, 0, 3, -5, -3]).fill({ color }).stroke({ color: 0x0a0706, width: 1 });
    beacon.rect(-2, -6, 2, 2).fill(0xffffff); // glint
    // Gold uniques get orbiting embers.
    if (rarity === 'gold') {
      beacon.rect(-9, -10, 2, 2).fill(0xfff1c4);
      beacon.rect(8, -6, 2, 2).fill(0xff9f1a);
      beacon.rect(-7, 0, 2, 2).fill(0xff9f1a);
    }
    const label = new Text({
      text: getItemBase(baseId)?.name ?? baseId,
      style: {
        fontFamily: 'Silkscreen, monospace',
        fontSize: 8,
        fill: color,
        stroke: { color: 0x000000, width: 3 },
      },
    });
    label.anchor.set(0.5, 1);
    label.y = -26;
    c.addChild(beacon, label);
    return c;
  }
  // mobId → { x, y } in tile coords, kept fresh from latest render frame
  // so damage floaters can spawn at the mob's last seen position even
  // after a fatal hit collapses the entry on the next snapshot.
  const lastMobPos = new Map<string, Vec2>();
  // mobId → last-known alive flag, to fire onMobKilled once on alive→dead (S12).
  const mobWasAlive = new Map<string, boolean>();

  function makePlayerSprite(name: string, isMe: boolean): PlayerSpriteEntry {
    const container = new Container();
    const feet = new Graphics()
      .ellipse(0, 1, 9, 4)
      .fill({ color: 0x000000, alpha: 0.4 });
    const body = new Sprite(HERO_FRAMES[SOUTH] ?? HERO_FRAMES[0]);
    body.anchor.set(HERO_ANCHOR[0], HERO_ANCHOR[1]); // feet-anchored
    body.scale.set(HERO_SCALE);
    if (!isMe) body.tint = 0xc9d6ff; // tint other players cool so "me" reads warm
    const label = new Text({
      text: name,
      style: { fontSize: 11, fill: 0xf0deba, stroke: { color: 0x000000, width: 3 } },
    });
    label.anchor.set(0.5, 1);
    label.y = -46;
    container.addChild(feet, body, label);
    return {
      container, body, frames: HERO_FRAMES, meta: heroMeta,
      facing: SOUTH, state: 'idle', clipElapsed: 0, lastPos: { x: 0, y: 0 },
    };
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
    const mf = assets.mobFrames(kind);
    const body = new Sprite(mf.frames[SOUTH] ?? mf.frames[0]);
    body.anchor.set(mf.anchor[0], mf.anchor[1]);
    body.scale.set(mf.scale);
    const label = new Text({
      text: kind,
      style: { fontSize: 10, fill: 0xd8cdbb, stroke: { color: 0x000000, width: 3 } },
    });
    label.anchor.set(0.5, 1);
    label.y = -44;
    const hpBar = new Graphics();
    hpBar.y = -42;
    container.addChild(targetRing, feet, body, label, hpBar);
    return {
      container, hpBar, body, targetRing, frames: mf.frames, meta: mf.meta,
      facing: SOUTH, state: 'idle', clipElapsed: 0, lastPos: { x: 0, y: 0 },
    };
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

  // ─── Channel client + interpolator ────────────────────────────
  const client: ChannelClient = createChannelClient({ wsUrl: opts.wsUrl });
  const interp = createSnapshotInterpolator({ lerpRate: 12 });
  // Delta snapshots (S24): rebuild full ZoneSnapshots from keyframe/delta frames
  // (or pass through un-delta'd snapshots from the Rift) before interpolating.
  const reconstructor = createSnapshotReconstructor();
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
        drawDecor(msg.npcs ?? [], msg.portals ?? []);
        break;
      case 'zone-transition':
        // Hand off to the target zone's channel (world-screen reconnects).
        opts.onZoneTransition?.(msg.zoneId);
        break;
      case 'rift-status':
        opts.onRiftStatus?.({ phase: msg.phase, kills: msg.kills, quota: msg.quota, deaths: msg.deaths, maxDeaths: msg.maxDeaths });
        break;
      case 'snapshot':
      case 'keyframe':
      case 'delta': {
        const snap = reconstructor.ingest(msg);
        if (snap) {
          interp.ingest(snap);
          latestGroundItems = snap.groundItems ?? [];
        }
        break;
      }
      case 'picked-up':
        requestedPickups.delete(msg.itemId);
        opts.onPickup?.(msg.baseId);
        break;
      case 'consumed': {
        // Heal feedback floats green over the local player; hp updates via snapshot.
        opts.onConsumed?.(msg.itemId);
        const me = lastFrame.players.find((p) => p.id === myId);
        if (me) {
          const at = tileToFx(me.pos);
          fx.spawnFloat(at.x, at.y - 30, `+${msg.heal}`, '#5ad17a', false);
        }
        break;
      }
      case 'damage': {
        const ev = msg.event;
        // A mob biting the player targets a player id (not a mob). Float the hit
        // over the player's sprite and skip the cast/projectile FX.
        if (ev.skillId === 'mob-contact') {
          const victim = lastFrame.players.find((p) => p.id === ev.targetId);
          if (victim) {
            const at = tileToFx(victim.pos);
            fx.spawnFloat(at.x, at.y - 24, `-${ev.amount}`, '#ff5a5a', true);
            if (ev.targetId === myId) shakeT = Math.max(shakeT, ev.fatal ? 0.4 : 0.12);
          }
          break;
        }
        const target = lastMobPos.get(ev.targetId);
        if (!target) break;
        const to = tileToFx(target);
        // The float + ash fire at impact (after projectile travel / meteor delay).
        const onImpact = (x: number, y: number) => {
          fx.spawnFloat(x, y - 18, ev.fatal ? 'KILL' : `-${ev.amount}`, ev.fatal ? '#ff5a5a' : '#ffd27a', !ev.fatal);
          if (ev.fatal) fx.ash(x, y);
        };
        if (ev.skillId === 'burn' || !ev.skillId) {
          // DoT tick / unattributed — small in-place pop, no cast.
          fx.emit({ x: to.x, y: to.y, vy: -28, r: 6, max: 0.4, fk: 'burn' });
          onImpact(to.x, to.y);
          break;
        }
        const glyph = SKILL_GLYPH[ev.skillId] ?? { glyph: 'orb', radius: 40 };
        const attacker = lastFrame.players.find((p) => p.id === ev.attackerId);
        const from = attacker ? tileToFx(attacker.pos) : { x: to.x, y: to.y - 40 };
        fx.cast({ glyph: glyph.glyph, radius: glyph.radius ?? 50, delay: glyph.delay ?? 0.6 }, from, to, onImpact);
        break;
      }
      case 'error':
        console.warn('[channel] error:', msg.reason);
        break;
    }
  }

  // Hand the parent a control surface for in-world actions driven from UI panels
  // (the inventory's "Use" button sends a consume request over the channel).
  opts.onControls?.({
    useItem: (itemId: string) => client.send({ type: 'use-item', itemId }),
    move: (target: Vec2) => client.send({ type: 'move', target }),
    attack: (mobId: string, skillId: string) => client.send({ type: 'attack', targetId: mobId, skillId }),
    castSkill: (skillId: string) => castSkill(skillId),
    getState: () => {
      const me = lastFrame.players.find((p) => p.id === myId);
      return {
        myId,
        me: me ? { pos: { x: me.pos.x, y: me.pos.y }, hp: me.hp } : null,
        mobs: lastFrame.mobs.map((m) => ({ id: m.id, pos: { x: m.pos.x, y: m.pos.y }, hp: m.hp, alive: m.alive })),
        ground: latestGroundItems.map((g) => ({ id: g.id, baseId: g.baseId, pos: { x: g.pos.x, y: g.pos.y } })),
      };
    },
  });

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
  // Client-predicted cooldowns + recent denies, keyed by skillId (ms timestamps
  // on the performance clock). The server stays authoritative; these just drive
  // the HUD sweep/grey-out/shake so a press never silently no-ops.
  const cdEndsAt = new Map<string, number>();
  const deniedAt = new Map<string, number>();
  let liveSpirit = 0;
  let liveWrath = 0;
  const keyToSkill = new Map(HOTBAR.map((s) => [s.key, s.skillId]));

  /** Find the nearest alive mob to the local player (auto-target). */
  function nearestMobId(from: Vec2): string | null {
    let best: string | null = null;
    let bestDist = Infinity;
    for (const mob of aliveMobsByTile.values()) {
      const d = Math.hypot(mob.pos.x - from.x, mob.pos.y - from.y);
      if (d < bestDist) {
        bestDist = d;
        best = mob.id;
      }
    }
    return best;
  }

  /**
   * Cast a hotbar skill. Auto-targets the nearest mob when nothing is engaged;
   * the server's sticky FSM then walks into range and fires. Returns false (and
   * flashes the deny shake) when on cooldown, unaffordable, or no target.
   */
  function castSkill(skillId: string): boolean {
    const meta = HOTBAR.find((s) => s.skillId === skillId);
    if (!meta || !myId) return false;
    const me = lastFrame.players.find((p) => p.id === myId);
    const now = performance.now();
    const deny = (): false => {
      deniedAt.set(skillId, now);
      return false;
    };
    if (!me) return deny();
    if (!canCast(meta, cdEndsAt.get(skillId) ?? 0, liveSpirit, liveWrath, now)) return deny();
    const targetId = me.engagedTargetId ?? nearestMobId(me.pos);
    if (!targetId) return deny(); // nothing to hit
    cdEndsAt.set(skillId, now + meta.cooldownMs); // optimistic — server is authoritative
    client.send({ type: 'attack', targetId, skillId });
    return true;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      e.preventDefault();
      client.send({ type: 'dodge' });
      return;
    }
    const skill = keyToSkill.get(e.key.toLowerCase());
    if (skill) castSkill(skill);
  }
  window.addEventListener('keydown', onKeyDown);

  // Frame cache so hotkey handlers don't need to re-run the interpolator.
  let lastFrame: ReturnType<typeof interp.interpolate> = { players: [], mobs: [] };
  let wasDead = false;

  // ─── Render loop ──────────────────────────────────────────────
  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    const frame = interp.interpolate(dt);
    lastFrame = frame;

    // Push the local player's live stats to the HUD (Spirit/Wrath/HP orbs).
    if (myId) {
      const meP = frame.players.find((p) => p.id === myId);
      if (meP) {
        liveSpirit = meP.spirit;
        liveWrath = meP.wrath;
        opts.onStats?.({
          spirit: meP.spirit,
          maxSpirit: meP.maxSpirit,
          wrath: meP.wrath,
          maxWrath: meP.maxWrath,
          hp: meP.hp,
          maxHp: meP.maxHp,
        });
        // Fire the death screen once on the rising edge of `dead`.
        if (meP.dead && !wasDead) opts.onDeath?.();
        wasDead = meP.dead;
      }
    }
    // Push the hotbar's live cooldown/castability to the HUD every frame so the
    // sweep animates and grey-out/deny react instantly to the keypress + regen.
    opts.onHotbar?.(hotbarView(cdEndsAt, deniedAt, liveSpirit, liveWrath, performance.now()));

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
      entry.container.alpha = p.dead ? 0.3 : 1; // corpses fade (S18)
      // Drive the walk/idle clip + facing from travel (S-anim).
      animateActor(entry, p.pos, ticker.deltaMS);
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
      // Detect the alive→dead transition once, to drive quest kill progress (S12).
      if (mobWasAlive.get(m.id) === true && !m.alive) opts.onMobKilled?.(m.kind);
      mobWasAlive.set(m.id, m.alive);
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
      // Walk/idle clip + facing for mobs (S-anim) — corpses freeze on last frame.
      if (m.alive) animateActor(entry, m.pos, ticker.deltaMS);
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
        mobWasAlive.delete(id);
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

    // ─── Pyromancy FX engine: advance + paint the overlay ────────
    fx.update(dt);
    // Meteor shake: jitter the world container around its base, decaying.
    if (shakeT > 0) {
      shakeT = Math.max(0, shakeT - dt);
      const amp = shakeT * 18;
      world.x = worldBaseX + (Math.random() - 0.5) * amp;
      world.y = worldBaseY + (Math.random() - 0.5) * amp;
    } else {
      world.x = worldBaseX;
      world.y = worldBaseY;
    }
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    fx.drawGround(fxCtx);
    fx.drawOver(fxCtx);
    fx.drawFloats(fxCtx);
  });

  return () => {
    unsubMsg();
    unsubStatus();
    client.close();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKeyDown);
    fxCanvas.remove();
    app.destroy(true, { children: true });
  };
}
