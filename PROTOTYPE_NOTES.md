# Tracer-bullet prototype — notes

**Status:** throwaway. Do not extend. Delete or absorb when answers captured.

## Question being answered

Does the ADR-0011 architecture (gateway + per-channel processes + binary WS protocol) and ADR-0012 tech stack (TypeScript + Node + PixiJS) actually compose into a working end-to-end loop where two browser tabs see each other on an isometric map, click-to-move with server-authoritative reconciliation, and click-to-damage a mob?

If yes → architecture is validated; proceed to PRD + tickets with confidence.
If no → identify the friction point (latency? PixiJS coordinate math? channel routing?) and revise the design.

## What this spike includes

- Gateway HTTP service: handshake endpoint that returns the channel WS URL + a fake player id/token
- Channel WS service: holds zone state for one 20×20 tile zone, runs a 20Hz tick loop, broadcasts state to all connected clients
- Client: PixiJS isometric tile map, two browser tabs see each other, click-to-move, click-on-mob-to-damage
- One stationary skeleton mob, 100 HP, respawns 5s after dying

## What this spike skips (deliberately)

- Discord OAuth / any real auth (display name via URL param)
- Postgres / Redis (in-memory only)
- Binary protocol (JSON over WS for debuggability — the real thing will be binary)
- More than one zone / dynamic channel routing
- Skills, disciplines, items, inventory, UI
- Solid.js (no menus in the spike)
- Tests, lint, polish

## Run

```
pnpm install
pnpm dev
```

Then open two browser tabs:
- `http://localhost:5173/?name=Alice`
- `http://localhost:5173/?name=Bob`

Both should see each other moving and the skeleton's HP draining when either attacks.

## Verdict — architecture VALIDATED

Drove the spike via headless browser eval. Outcomes:

- [x] **Gateway handshake works.** HTTP `GET /connect?name=X` returns `{channelUrl, playerId, token}`. Client uses the channelUrl to open WS to the channel process. Confirms the ADR-0011 routing pattern is wire-compatible.
- [x] **Channel WS protocol works.** Hello message authenticates (spike: token-presence check), server welcomes with `{you, zoneSize}`, snapshot broadcast at 20Hz reliably reaches the client.
- [x] **Click-to-move with server reconciliation works.** Client sends `{type: 'move', target}`. Server clamps to bounds, lerps position over ticks, broadcasts snapshots. Client lerps render-positions toward snapshot positions (12 Hz convergence) for smooth visual motion.
- [x] **Click-to-attack with server-side range validation works.** Server enforces `dist(player, mob) <= 2.0`, rejects out-of-range with an error message, applies damage when valid. Killed the skeleton in 9 hits (12 dmg × 9 = 108 > 100 HP).
- [x] **Mob respawn works.** Skeleton died, server logged `respawn in 5000ms`, server logged `respawned` 5s later. Snapshot loop carried the alive/dead state cleanly.
- [x] **PixiJS isometric rendering works.** 20×20 tile grid, alternating shades, screen↔tile coordinate math correct. Depth-sorting by y so entities at lower y draw behind entities at higher y.
- [x] **End-to-end loop survives all three processes running together.** No "service A can't reach service B" foot-guns — concurrently + workspace `:*` deps work cleanly.

## Lessons to feed back into the real design

1. **Click-to-attack target-stickiness needed.** Current spike fires a fresh `move` command on every click *plus* an `attack`, which makes the player chase a moving point. Real impl: clicking on a mob should set a sticky "attack target" — client walks once to attack range, then keeps attacking until target dies, player clicks elsewhere, or target out of LOS. This is the D2/PoE default and the spike's omission of it was immediately annoying. Add to skill design notes.

2. **Server-side attack-rate clamp (250ms) was a good defensive add.** Real impl: this is the per-skill cooldown system — generalize from "global attack rate" to "per-skill cooldown timestamp map."

3. **Snapshot broadcast at 20Hz with full state was fine at 1–2 players in 1 zone.** At 50 players with mobs+projectiles, full-state-every-tick will be too much bandwidth. Need delta encoding or interest-management snapshots before scale-testing. Flag for when the channel cap stress-test happens.

4. **JSON over WS was great for spike debuggability** — recommend keeping a JSON dev-mode flag in the real binary protocol so dumps stay readable during dev.

5. **No surprises on the stack itself.** TypeScript + Node + PixiJS + pnpm workspaces + tsx-watch + vite all composed without friction. No reason to revisit ADR-0012.

## Cleanup plan

This code lives at `/apps/*` and `/packages/protocol/*` and is **throwaway**. When the real implementation starts, **delete `apps/server-gateway/src/index.ts`, `apps/server-channel/src/index.ts`, `apps/client/src/main.ts`** and start from the design with these lessons in hand. The package skeleton + tsconfig + workspace setup can be kept and built upon.
