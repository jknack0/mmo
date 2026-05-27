# Next Steps

Snapshot of where the project stands and what's still open. Read this first when picking back up.

---

## How to pick up

```sh
git pull
pnpm install
pnpm dev   # gateway:8080  channel:8081  client:5173
```

Open `http://localhost:5173/?name=Alice` and `http://localhost:5173/?name=Bob` in two tabs to drive the spike.

**Read in this order to get oriented:**
1. [`CONTEXT.md`](./CONTEXT.md) — domain glossary, the project-specific language
2. [`docs/adr/`](./docs/adr/) — the 16 ADRs covering every locked decision and why
3. [`PROTOTYPE_NOTES.md`](./PROTOTYPE_NOTES.md) — the spike's verdict and engineering lessons
4. This file — what's still open

---

## ✅ Locked (16 ADRs)

| # | Decision | One-line summary |
|---|---|---|
| [0001](./docs/adr/0001-shared-world-architecture.md) | Shared-world architecture | Lost Ark-style channeled open zones, not D2 lobbies |
| [0002](./docs/adr/0002-2d-isometric-sprite-rendering.md) | 2D iso sprite rendering | PixiJS sprites, not 3D meshes — art-pipeline reality for solo dev |
| [0003](./docs/adr/0003-click-to-move-with-lost-ark-skill-bar.md) | Click-to-move + LA skill bar | Mouse movement, 8-skill hotbar, no WASD |
| [0004](./docs/adr/0004-classless-discipline-system.md) | Classless 2-discipline | Pick 2 of 6 disciplines from trainers; tripods + passive trees |
| [0005](./docs/adr/0005-itemization-d2-with-refinement.md) | D2 items + tapping | Full D2 affix model + Lost Ark item tapping; no item destruction |
| [0006](./docs/adr/0006-stats-from-gear-not-allocation.md) | Stats from gear only | 4 D2-named stats, never manually allocated |
| [0007](./docs/adr/0007-endgame-loop-three-pillars-no-dailies.md) | Endgame: 3 pillars, no dailies | Rifts + Trials + World Activities; Vigor catchup |
| [0008](./docs/adr/0008-death-penalty-light-with-run-attempt-caps.md) | Light death penalty | No XP loss; Rift 3-deaths-then-fail; Hardcore deferred |
| [0009](./docs/adr/0009-pvp-deferred-pve-focus.md) | PvP deferred | Classless makes PvP combinatorially hard; PvE-first |
| [0010](./docs/adr/0010-two-resource-system-spirit-and-wrath.md) | Spirit + Wrath | Two-resource combat: fast regen + combat-built |
| [0011](./docs/adr/0011-channel-architecture-50-100-one-process-per-channel.md) | Channel cap 50/100 | One Node process per channel; ~1k–2.5k concurrent target |
| [0012](./docs/adr/0012-tech-stack.md) | Tech stack | TS + PixiJS + Solid + Node + Postgres + Redis + Discord OAuth + WebSocket |
| [0013](./docs/adr/0013-persistence-write-through-plus-snapshot.md) | Two-tier persistence | Write-through for high-value; 30s snapshot for session state |
| [0014](./docs/adr/0014-visual-art-direction.md) | Dark gothic art | D2-dark backgrounds + vivid VFX; hand-painted sprites |
| [0015](./docs/adr/0015-setting-post-sundering-dying-world.md) | Setting | Vael, post-Sundering, Awakened, Hold Veridian, the Veil |
| [0016](./docs/adr/0016-social-systems-modern-bar-guild-light.md) | Social | Modern bar (party, friends, mail, chat, finder); guild-light Orders |

---

## 🔁 Open grilling threads

### Mid-conversation — already proposed, awaiting decision

- **Q18 — Monetization** *(proposed but not locked)*
  - Proposal: free during alpha/beta → at launch, F2P + cosmetic-only cash shop + optional Patreon
  - Explicit no's: power, convenience, time saves, loot boxes, subscriptions, battle pass
  - AH 5% gold fee as in-game sink
  - **Decision needed before locking ADR**

### Not yet started

- **Discipline skill design** — pick one discipline (probably Pyromancy) and enumerate all 12 skills + tripod choices + passive tree as a worked example. This gives a template the others can follow.
- **Zone authoring tooling** — what tools do we need to build zones efficiently? Tile editor? JSON-authored zones? Spreadsheet-imported mob spawn tables? Determines content-creation velocity.
- **Anything else you want to grill** — quest system design, NPC dialogue/branching, achievement system, telemetry/analytics philosophy, dev tools, content cadence post-launch, etc.

---

## 🕓 Reserved (explicitly deferred, not deleted)

These have ADRs or glossary entries that *name* them but punt the design. Don't start any of them at launch.

- **Hardcore mode** — opt-in permadeath ladder (ADR-0008)
- **PvP** in any form — dueling, arena, world (ADR-0009)
- **Inscription** — runeword-equivalent crafting (ADR-0005)
- **Seasonal ladder** — D2-style fresh-economy seasons (glossary)
- **Order banks / halls / quests / OvO** — guild content beyond basic structure (ADR-0016)
- **Vael final name** — placeholder; commit a real name before launch (glossary)
- **Spirit/Wrath details revisit** — system is locked but specific numbers (regen rates, cap, decay) are tentative

---

## 🛠️ Engineering lessons from the spike

(Full detail in [`PROTOTYPE_NOTES.md`](./PROTOTYPE_NOTES.md). Headlines:)

1. **Click-to-attack target-stickiness** — spike fires fresh move+attack on every click; real impl needs "sticky attack target" (D2/PoE default).
2. **Per-skill cooldown timestamp map** — generalize the spike's 250ms global attack-rate clamp.
3. **Snapshot bandwidth at scale** — full state per tick is fine at 2 players, will not survive 50. Delta encoding or interest-management is the next architectural piece *before* the channel-cap stress test.
4. **JSON dev-mode flag** — keep a debuggable JSON mode in the real binary protocol.
5. **Stack itself: no surprises.** TS + Node + PixiJS + pnpm + tsx + vite composed cleanly. No revisit to ADR-0012 needed.

---

## 🗺️ Task ladder

The order is roughly:

1. Finish remaining grilling threads (monetization → disciplines → tooling → anything else)
2. `to-prd` — compile design into a PRD published to the issue tracker
3. `to-issues` — break the PRD into tracer-bullet vertical-slice tickets
4. **Delete the spike** (`apps/server-gateway/src/index.ts`, `apps/server-channel/src/index.ts`, `apps/client/src/main.ts`) and start the real implementation from those tickets
5. Build, iterate, alpha

The pnpm workspace skeleton, tsconfigs, and `packages/protocol` *do* survive past the spike — only the `src/index.ts` files in each app are throwaway.

---

## 📦 What's in the repo

```
mmo/
├── CONTEXT.md             ← domain glossary
├── PROTOTYPE_NOTES.md     ← spike verdict + lessons
├── NEXT_STEPS.md          ← this file
├── docs/adr/              ← 16 ADRs, the locked decisions
├── apps/
│   ├── client/            ← spike: PixiJS iso client (throwaway src)
│   ├── server-gateway/    ← spike: HTTP handshake (throwaway src)
│   └── server-channel/    ← spike: WS zone state (throwaway src)
├── packages/
│   └── protocol/          ← shared message types (keepable shape)
├── .claude/launch.json    ← preview tool config (committed)
└── pnpm-workspace.yaml    ← workspace setup
```
