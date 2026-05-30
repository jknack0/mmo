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
  const fxLayer = new Container();
  const floaterLayer = new Container();
  world.addChild(terrainLayer, groundLayer, entityLayer, fxLayer, floaterLayer);

  // ─── Per-skill fire FX ─────────────────────────────────────────
  // Each skill picks a projectile style (caster→target travel) and an impact
  // style (what happens on the target). Matches the Claude-Design FX recipes.
  type ProjStyle = 'small' | 'big' | 'lance';
  type ImpactStyle =
    | 'small' | 'big' | 'ring' | 'column' | 'meteor' | 'cone' | 'slash' | 'tick';
  const SKILL_FX: Record<string, { proj?: ProjStyle; impact: ImpactStyle }> = {
    'basic-attack': { impact: 'slash' },
    spark: { proj: 'small', impact: 'small' },
    'cinder-spray': { impact: 'cone' },
    'heat-wave': { impact: 'ring' },
    fireball: { proj: 'big', impact: 'big' },
    'flame-lance': { proj: 'lance', impact: 'small' },
    combust: { impact: 'ring' },
    meteor: { impact: 'meteor' },
    firestorm: { impact: 'big' },
    'wall-of-flame': { impact: 'cone' },
    'ember-step': { impact: 'cone' },
    pyroclasm: { proj: 'big', impact: 'column' },
    cataclysm: { impact: 'meteor' },
    burn: { impact: 'tick' },
  };
  const DEFAULT_FX = { proj: 'small' as ProjStyle, impact: 'big' as ImpactStyle };
  const IMPACT_DUR: Record<ImpactStyle, number> = {
    small: 0.3, big: 0.45, ring: 0.4, column: 0.46, meteor: 0.75, cone: 0.34, slash: 0.2, tick: 0.26,
  };
  const PROJ_DUR: Record<ProjStyle, number> = { small: 0.22, big: 0.32, lance: 0.16 };

  const dia = (r: number) => [0, -r, r, 0, 0, r, -r, 0];

  interface Fx { g: Graphics; life: number; max: number; style: ImpactStyle }
  const fxs: Fx[] = [];

  function drawFx(g: Graphics, t: number, style: ImpactStyle): void {
    g.clear();
    const p = 1 - t; // 0→1 progress
    const a = Math.min(1, t * 1.5);
    const burst = (base: number, embers: number) => {
      const r = base * (0.45 + p);
      g.poly(dia(r)).fill({ color: 0xb0301a, alpha: 0.55 * a });
      g.poly(dia(r * 0.66)).fill({ color: 0xff9f1a, alpha: 0.85 * a });
      g.poly(dia(r * 0.32)).fill({ color: 0xfff1c4, alpha: a });
      for (let i = 0; i < embers; i++) {
        const ang = (i / embers) * Math.PI * 2 + p * 2;
        g.rect(Math.cos(ang) * r * 1.1, Math.sin(ang) * r * 0.66, 2, 2).fill({ color: 0xff9f1a, alpha: a });
      }
    };
    switch (style) {
      case 'tick': {
        const r = 3 * (0.6 + p * 0.7);
        g.poly(dia(r)).fill({ color: 0xff6a3a, alpha: 0.85 * a });
        g.rect(-1, -r - 1, 2, 2).fill({ color: 0xffe9b0, alpha: a });
        break;
      }
      case 'small': burst(9, 3); break;
      case 'big': burst(18, 6); break;
      case 'ring': {
        const r = 8 + p * 30;
        g.poly(dia(r)).stroke({ color: 0xff9f1a, width: 3, alpha: a });
        g.poly(dia(r * 0.7)).stroke({ color: 0xfff1c4, width: 2, alpha: a * 0.8 });
        break;
      }
      case 'column': {
        const h = 50 * (0.5 + p * 0.6);
        g.rect(-8, -h, 16, h).fill({ color: 0xb0301a, alpha: 0.4 * a });
        g.rect(-5, -h, 10, h).fill({ color: 0xff9f1a, alpha: 0.7 * a });
        g.rect(-2, -h, 4, h).fill({ color: 0xfff1c4, alpha: a });
        for (let i = 0; i < 4; i++) {
          const ex = (((i * 977 + 31) % 16) - 8);
          g.rect(ex, -h * ((i * 0.27 + p) % 1), 2, 2).fill({ color: 0xffd24a, alpha: a });
        }
        break;
      }
      case 'cone': {
        for (let i = 0; i < 7; i++) {
          const ang = -Math.PI / 2 + (i / 6 - 0.5) * 1.4;
          const d = (6 + p * 22) * (0.6 + (i % 3) * 0.2);
          const c = i % 2 ? 0xff9f1a : 0xffd24a;
          g.rect(Math.cos(ang) * d, Math.sin(ang) * d * 0.7, 3, 3).fill({ color: c, alpha: a });
        }
        break;
      }
      case 'slash': {
        const w = 18 * (0.5 + p);
        g.moveTo(-w, -w * 0.5).lineTo(w, -2).lineTo(-w * 0.6, w * 0.5).stroke({ color: 0xffffff, width: 2, alpha: a });
        break;
      }
      case 'meteor': {
        if (p < 0.62) {
          const fp = p / 0.62;
          const fy = -78 + fp * 78;
          g.circle(0, fy, 7).fill({ color: 0xff6a3a, alpha: 0.5 });
          g.rect(-3, fy - 3, 6, 6).fill({ color: 0xb0301a });
          g.rect(-2, fy - 2, 4, 4).fill({ color: 0xff9f1a });
          g.rect(-1, fy - 8, 2, 6).fill({ color: 0xffd24a, alpha: 0.8 }); // trail up
        } else {
          const ip = (p - 0.62) / 0.38;
          const r = 24 * (0.4 + ip);
          g.poly(dia(r)).fill({ color: 0xb0301a, alpha: 0.5 * (1 - ip) });
          g.poly(dia(r * 0.6)).fill({ color: 0xff9f1a, alpha: 0.85 * (1 - ip) });
          g.poly(dia(r * 1.2)).stroke({ color: 0xffd24a, width: 2, alpha: (1 - ip) });
        }
        break;
      }
    }
  }

  function spawnImpactFx(targetTile: Vec2, style: ImpactStyle, fatal: boolean, amount: number): void {
    const g = new Graphics();
    const s = tileToScreen(targetTile);
    g.x = s.x;
    g.y = s.y - 12;
    fxLayer.addChild(g);
    const max = IMPACT_DUR[style];
    fxs.push({ g, life: max, max, style });
    spawnFloater(targetTile, fatal ? 'KILL' : `-${amount}`, fatal ? 0xff5555 : 0xffcc66, fatal);
  }

  // ─── Fire projectiles (caster → target) ───────────────────────
  interface Proj {
    g: Graphics;
    from: Vec2;
    to: Vec2;
    t: number;
    dur: number;
    projStyle: ProjStyle;
    targetTile: Vec2;
    impactStyle: ImpactStyle;
    fatal: boolean;
    amount: number;
  }
  const projs: Proj[] = [];

  function spawnProjectile(
    fromTile: Vec2,
    targetTile: Vec2,
    projStyle: ProjStyle,
    impactStyle: ImpactStyle,
    fatal: boolean,
    amount: number
  ): void {
    const g = new Graphics();
    fxLayer.addChild(g);
    const fs = tileToScreen(fromTile);
    const ts = tileToScreen(targetTile);
    projs.push({
      g,
      from: { x: fs.x, y: fs.y - 22 },
      to: { x: ts.x, y: ts.y - 12 },
      t: 0,
      dur: PROJ_DUR[projStyle],
      projStyle,
      targetTile,
      impactStyle,
      fatal,
      amount,
    });
  }

  function drawBolt(g: Graphics, x: number, y: number, dx: number, dy: number, style: ProjStyle): void {
    g.clear();
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const k = style === 'big' ? 1.4 : style === 'lance' ? 1.0 : 0.8;
    const trail = style === 'lance' ? 30 : 16;
    g.circle(x, y, 9 * k).fill({ color: 0xff9f1a, alpha: 0.22 });
    g.circle(x, y, 6 * k).fill({ color: 0xff6a3a, alpha: 0.32 });
    g.rect(x - ux * trail - 1, y - uy * trail - 1, 2, 2).fill({ color: 0xb0301a, alpha: 0.7 });
    g.rect(x - ux * (trail * 0.7) - 1, y - uy * (trail * 0.7) - 1, 3, 3).fill({ color: 0xe0531f });
    g.rect(x - ux * 7 - 2, y - uy * 7 - 2, 4 * k, 4 * k).fill({ color: 0xff9f1a });
    g.rect(x - ux * 3 - 3, y - uy * 3 - 3, 6 * k, 6 * k).fill({ color: 0xffd24a });
    g.rect(x - 3 * k, y - 3 * k, 6 * k, 6 * k).fill({ color: 0xfff1c4 });
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
        const target = lastMobPos.get(msg.event.targetId);
        if (!target) break;
        const cfg = SKILL_FX[msg.event.skillId ?? ''] ?? DEFAULT_FX;
        const attacker = lastFrame.players.find((p) => p.id === msg.event.attackerId);
        const far = attacker && Math.hypot(attacker.pos.x - target.x, attacker.pos.y - target.y) > 0.6;
        // Skills with a projectile fly a bolt from the caster, then impact on
        // arrival; the rest (and Burn ticks) impact in place.
        if (cfg.proj && attacker && far) {
          spawnProjectile(attacker.pos, target, cfg.proj, cfg.impact, msg.event.fatal, msg.event.amount);
        } else {
          spawnImpactFx(target, cfg.impact, msg.event.fatal, msg.event.amount);
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

    // Fire projectiles — fly, then impact on arrival.
    for (let i = projs.length - 1; i >= 0; i--) {
      const pr = projs[i]!;
      pr.t += dt;
      const p = Math.min(1, pr.t / pr.dur);
      const x = pr.from.x + (pr.to.x - pr.from.x) * p;
      const y = pr.from.y + (pr.to.y - pr.from.y) * p;
      drawBolt(pr.g, x, y, pr.to.x - pr.from.x, pr.to.y - pr.from.y, pr.projStyle);
      if (p >= 1) {
        fxLayer.removeChild(pr.g);
        projs.splice(i, 1);
        spawnImpactFx(pr.targetTile, pr.impactStyle, pr.fatal, pr.amount);
      }
    }

    // Fire FX impacts
    for (let i = fxs.length - 1; i >= 0; i--) {
      const fx = fxs[i]!;
      fx.life -= dt;
      if (fx.life <= 0) {
        fxLayer.removeChild(fx.g);
        fxs.splice(i, 1);
        continue;
      }
      drawFx(fx.g, fx.life / fx.max, fx.style);
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
