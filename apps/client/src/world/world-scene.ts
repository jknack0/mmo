// PixiJS-backed iso-world scene. Composes the terrain, entity, and input
// layers, drives them from a ChannelClient + SnapshotInterpolator. Single
// public entry: `mountWorldScene(container, opts) → cleanup`.

import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  decodeServerMessage,
  type ServerMessage,
  type Vec2,
} from '@mmo/protocol';
import { createChannelClient, type ChannelClient } from '../network/channel-client.js';
import { createSnapshotInterpolator } from '../network/snapshot-interpolator.js';
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
  world.addChild(terrainLayer, entityLayer);

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

  // ─── Player sprites ──────────────────────────────────────────
  interface SpriteEntry {
    container: Container;
    label: Text;
    body: Graphics;
  }
  const sprites = new Map<string, SpriteEntry>();

  function makeSprite(name: string, isMe: boolean): SpriteEntry {
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
    return { container, label, body };
  }

  // ─── Channel client + interpolator ────────────────────────────
  const client: ChannelClient = createChannelClient({ wsUrl: opts.wsUrl });
  const interp = createSnapshotInterpolator({ lerpRate: 12 });
  let myId: string | null = null;
  let zoneSize: Vec2 = { x: 30, y: 30 };

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

  // Also surface raw decode errors during dev (in addition to the typed
  // onMessage stream the ChannelClient already provides).
  // No-op here: the ChannelClient already swallows malformed frames.
  void decodeServerMessage;

  // ─── Input: click-to-move ─────────────────────────────────────
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.on('pointerdown', (e) => {
    const wx = e.global.x - world.x;
    const wy = e.global.y - world.y;
    const tile = screenToTile({ x: wx, y: wy });
    if (
      tile.x < 0 ||
      tile.y < 0 ||
      tile.x > zoneSize.x - 1 ||
      tile.y > zoneSize.y - 1
    ) {
      return;
    }
    client.send({ type: 'move', target: tile });
  });

  // ─── Render loop ──────────────────────────────────────────────
  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000;
    const frame = interp.interpolate(dt);
    const seen = new Set<string>();
    for (const p of frame) {
      seen.add(p.id);
      let entry = sprites.get(p.id);
      if (!entry) {
        entry = makeSprite(p.name, p.id === myId);
        sprites.set(p.id, entry);
        entityLayer.addChild(entry.container);
      } else if (entry.label.text !== p.name) {
        entry.label.text = p.name;
      }
      const s = tileToScreen(p.pos);
      entry.container.x = s.x;
      entry.container.y = s.y;
      entry.container.zIndex = p.pos.y;
    }
    for (const [id, entry] of sprites) {
      if (!seen.has(id)) {
        entityLayer.removeChild(entry.container);
        sprites.delete(id);
      }
    }
    entityLayer.sortChildren();
  });

  return () => {
    unsubMsg();
    unsubStatus();
    client.close();
    window.removeEventListener('resize', onResize);
    app.destroy(true, { children: true });
  };
}
