# PRD — Alpha Vertical Slice

> Scope: the smallest end-to-end playable build that proves the locked design works. Foundation for all subsequent feature PRDs.
>
> Anchored against 18 ADRs in [`/docs/adr/`](../adr/) and the canonical Pyromancy worked example in [`/docs/disciplines/pyromancy.md`](../disciplines/pyromancy.md). The pnpm workspace skeleton and `packages/protocol` survive from the validated spike (see [`/PROTOTYPE_NOTES.md`](../../PROTOTYPE_NOTES.md)); the spike `src/index.ts` files are throwaway and get deleted at the start of this work.

---

## Problem Statement

There is no playable build of the game. 18 ADRs have locked the design — shared persistent world with channels, classless 2-discipline character system, Lost-Ark-style click-to-move with a 6-skill hotbar, two-resource combat (Spirit + Wrath), D2-style itemization with tapped Refinement, three-pillar endgame anchored on Rifts — but only a throwaway tracer-bullet spike exists to prove the stack composes. Without an actual playable slice, none of these decisions are validated against real player behavior, the engineering risks flagged during the spike (snapshot bandwidth at scale, sticky attack targeting, per-skill cooldown maps) cannot be addressed against a real codebase, and the solo developer has no concrete artifact to iterate on, hand to early playtesters, or build outward from.

## Solution

A playable alpha vertical slice that exercises every load-bearing system in the locked design at a minimum-viable depth. One playable Hold (Hold Veridian) with discipline trainers and a vendor; one open-world zone (channels at 50 cap) connected to the Hold; one instanced T1 Rift dungeon; the Pyromancy discipline implemented end-to-end as the canonical worked example, plus one additional discipline (Blademaster) at reduced fidelity to validate the 2-discipline mixing system; click-to-move with sticky attack targeting and a 6-key skill hotbar; full Spirit + Wrath resource model; D2-style itemization with affix rolls, tapping for Refinement, and a vendor; server-authoritative combat with proper range and cooldown enforcement; Discord OAuth + email auth; gateway-routed connection to per-channel Node processes; two-tier persistence (write-through high-value events + 30s snapshot for session state); Postgres + Redis backing all of it. No PvP, no Trials, no auction house, no Orders, no party system beyond two-player ad-hoc grouping, no five-of-six disciplines, no most-zones, no most-mobs — those are all post-alpha PRDs. Players can: create an account, create a character, learn Pyromancy from a trainer, equip 6 skills, fight their way through an open zone, kill mobs, get items, equip them, tap them, talk to a vendor, run a Rift, die, respawn, and feel the loop is real.

## User Stories

1. As a new player, I want to log in via Discord OAuth, so that I don't have to remember another password.
2. As a player without a Discord account, I want to sign up with email + password, so that I can still play.
3. As a returning player, I want a persistent session token, so that I don't have to re-authenticate every time I open the game.
4. As a new player, I want to create a character with a chosen name and visual variation, so that I can identify with my avatar.
5. As a player with multiple alts, I want a character-select screen listing all my characters, so that I can pick which one to play.
6. As a new player on first login, I want to spawn in Hold Veridian, so that I'm in the canonical hub town.
7. As a player in a town, I want to share the town channel with up to 100 other players, so that the social hub feels populated.
8. As a player walking out of town, I want to be assigned to an open-world zone channel, so that I see other players in the zone with me.
9. As a player whose current channel is full, I want to be auto-assigned to a new channel of the same zone, so that I'm never blocked from playing by capacity.
10. As a player, I want to manually switch channels in the same zone, so that I can find friends or escape a crowded channel.
11. As a player, I want to move my character by clicking on the ground, so that movement matches the D2/Lost Ark feel.
12. As a player, I want my character's movement to be smoothly interpolated despite a 20Hz server snapshot rate, so that motion doesn't look jerky.
13. As a player, I want the server to authoritatively validate my movement, so that other players see the same state I do.
14. As a player, I want a primary right-mouse weapon attack at the cursor with no cooldown, so that I always have a Spirit-generating filler attack available.
15. As a player, I want a spacebar dodge with brief invulnerability frames, so that I can react to telegraphed attacks.
16. As a player, I want to slot 6 skills (out of 24 available across my 2 equipped disciplines) on a hotbar bound to 6 keys, so that combat is hotkey-driven.
17. As a player, I want each skill to have its own server-validated cooldown (not a global cooldown), so that rotations feel granular.
18. As a Pyromancy user, I want clicking on a mob to set a sticky attack target — walking once to attack range, then attacking until the target is dead or I click elsewhere — so that I'm not chasing a phantom point.
19. As a player, I want my Spirit resource to regenerate over time (~1.5%/sec out of combat, ~0.5%/sec in combat) and from right-click attacks, so that I can always cast my low-cost skills.
20. As a player, I want my Wrath resource to build only from dealing damage and decay slowly out of combat, so that elite skill timing is a real decision.
21. As a player, I want my INT stat to raise my max Spirit pool, so that gear scaling reflects the locked stat model.
22. As a player, I want to visit a discipline trainer NPC in Hold Veridian to learn Pyromancy after a short quest, so that disciplines feel earned not bought.
23. As a player who has learned Pyromancy and one other discipline (Blademaster at reduced alpha fidelity), I want to equip both as my 2 active disciplines, so that I have access to 24 total skills to pick from.
24. As a Pyromancy player, I want all 12 Pyromancy skills available (Ember Step, Spark, Cinder Spray, Heat Wave, Fireball, Flame Lance, Combust, Meteor, Firestorm, Wall of Flame, Pyroclasm, Cataclysm), so that the worked example is fully realized.
25. As a player, I want each skill to expose its 2-tier × 3-choice tripod configuration UI, so that I can specialize each slotted skill.
26. As a Pyromancy player, I want my passive tree to be a 3-path 20-node tree (2 root + Burn / Direct / Utility paths), so that I can lean into a sub-archetype.
27. As a player, I want a single ~20-point passive pool shared across both equipped disciplines, so that cross-discipline allocation is a real trade-off.
28. As a player, I want my final stats (HP, Spirit cap, damage, crit, etc.) to be computed live from gear + passives + discipline level, so that gear changes are visibly impactful.
29. As a player, I want to see HP, Spirit, and Wrath bars on the HUD, so that I can read my resources at a glance.
30. As a player, I want skill cooldowns visible as overlays on the hotbar, so that I can time my rotations.
31. As a player, I want to see floating damage numbers on hits, so that I can read combat outcomes.
32. As a player attacking a mob, I want server-side range validation, so that the game doesn't let me hit things I shouldn't be able to.
33. As a player, I want to apply Burn stacks to enemies via specific Pyromancy skills, so that the Burn DoT damage-type interacts with my build.
34. As a player using Combust, I want stacks consumed for bonus damage per stack, so that the Burn-stacker archetype has a payoff mechanic.
35. As a Flashburn keystone user, I want Burn application disabled in exchange for +40% Pyro damage, so that the Direct-burst archetype is a build-defining choice.
36. As an Inferno keystone user, I want the Burn stack cap removed, so that the Burn-stacker archetype scales linearly with stack count.
37. As a player, I want mobs in the open zone to have appropriate aggro behavior (idle, aggro on player approach, attack, die, respawn after a fixed time), so that the world feels alive.
38. As a player killing a mob, I want loot drops based on a per-mob drop table with affix rolls, so that itemization feels random and meaningful.
39. As a player, I want item drops to come in D2-faithful tiers (white / blue / yellow / green / gold) with the locked rarity color convention, so that drop signaling is instantly readable.
40. As a player, I want item affixes split ~60/40 between stat-flavored ("+15 Strength") and skill-flavored ("+1 Pyromancy skills"), so that the affix model matches the locked itemization design.
41. As a player, I want to pick up items by walking over them or clicking them, so that loot collection has tactile feedback.
42. As a player, I want an inventory grid showing all carried items, so that I can manage my haul.
43. As a player, I want to equip items to specific gear slots, so that my stats update accordingly.
44. As a player, I want to compare a hovered item to my currently-equipped item, so that upgrade decisions are obvious.
45. As a player, I want to tap an item to attempt Refinement (+0 to +10), consuming materials, with failure leaving the item intact at its current Refinement level, so that tapping carries weight without rage-quit risk.
46. As a player who has failed tapping enough times, I want a pity counter to guarantee eventual success, so that the system never feels punishingly random.
47. As a player visiting a vendor NPC in Hold Veridian, I want to sell unwanted items for gold, so that loot has economic floor value.
48. As a player visiting a vendor, I want to buy basic consumables (HP potions, etc.) and tapping materials, so that the economy has friction-reducing utilities.
49. As a player, I want Magic Find as a character-level statistic (not a gear affix), so that I'm never forced into MF outfits.
50. As a player, I want my zone to be visibly D2-dark gothic with vivid combat VFX overlaid, so that the locked art direction is recognizable.
51. As a player, I want to enter the alpha Rift (T1) from a portal/NPC in Hold Veridian, so that endgame content is reachable.
52. As a player entering a Rift, I want to be moved into a private instance for myself (or my party of up to 2 at alpha), so that the run is mine.
53. As a player in a Rift, I want a two-phase run (wave-clear → mini-boss kill) lasting ~10–15 minutes, so that the canonical Rift shape is locked from day one.
54. As a player in a Rift, I want a 3-deaths-then-fail cap, so that death has run-internal weight.
55. As a player completing a Rift, I want guaranteed boss-kill rewards (one item drop + materials), so that the loop is rewarding.
56. As a player dying in open world, I want to respawn at the nearest safe point with a small gold repair cost, so that death stings lightly but never costs XP.
57. As a player, I want my character's position + current HP + equipped loadout to be snapshotted every 30 seconds and on every zone change, so that a crash never costs more than 30 seconds of state.
58. As a player, I want any item drop, vendor transaction, or level-up to commit synchronously to Postgres, so that economic outcomes are durable.
59. As a player whose channel process crashes, I want to be kicked back to character select with my character preserved at last snapshot, so that crash recovery is graceful.
60. As a developer running locally, I want JSON-mode protocol available behind a dev flag, so that I can debug wire payloads.
61. As a developer, I want a custom WebSocket load-test rig that can simulate 50 concurrent clients per channel, so that I can validate the cap before production.
62. As a developer, I want all server-authoritative validators (movement bounds, attack range, skill cooldown) covered by unit tests, so that desync bugs are caught early.
63. As a developer, I want StatCalculator, SkillResolver, DropTable, and TappingService covered by pure-function unit tests, so that domain rules don't drift.
64. As a developer, I want CharacterRepo, InventoryRepo, and AuditLog covered by integration tests against a real Postgres, so that schema and Kysely query correctness are verified.
65. As a developer, I want at least one end-to-end Playwright test covering connect → walk → attack → kill → loot, so that the full loop has regression coverage.

## Implementation Decisions

### Repository structure (already in place, retained)
- `pnpm` monorepo with workspaces.
- `apps/client` (PixiJS rendering + Solid.js UI), `apps/server-gateway`, `apps/server-channel`, `packages/protocol` (shared wire types + encoder), `packages/domain` (shared item / skill / discipline schemas, pure rule logic).
- Spike `src/index.ts` files in each app are deleted at the start of work. tsconfig + package.json scaffolding + `packages/protocol`'s message-shape file survive.

### Server modules to build

**Gateway** (`apps/server-gateway`)
- `AuthService` — Discord OAuth flow + email/bcrypt fallback. Issues session tokens (random string, Redis-backed TTL). Single interface: `authenticate(credentials) → SessionToken | AuthError`.
- `CharacterService` — character CRUD on top of `CharacterRepo`. Single interface: `listCharacters(accountId)`, `createCharacter(accountId, name, ...)`, `loadCharacter(accountId, characterId)`.
- `ChannelRouter` — given `(zoneId, intendedCapacity)`, returns ws URL of an open channel; spins new channel processes when all are at capacity. Holds the channel-routing table in Redis. Single interface: `routeToChannel(zoneId, accountId) → { wsUrl, channelId }`.
- HTTP handshake endpoint that returns `{ wsUrl, sessionToken }` after auth.

**Channel server** (`apps/server-channel`, one OS process per channel per ADR-0011)
- `ZoneState` — authoritative state for one channel of one zone. Owns: player entities, mobs, projectiles, dropped items, cooldown timestamp maps, sticky-attack-target map. Single interface for systems: `getEntity(id)`, `forEachPlayer(fn)`, `applyDamage(...)`, etc.
- `TickLoop` — drives all systems at 20Hz. Each tick: process inbound commands → step systems (movement, combat, mob AI, projectiles) → encode snapshot → broadcast.
- `MovementSystem` — server-authoritative click-to-move. Lerps positions over ticks toward target; clamps to zone bounds; validates against zone tile map (no walking through walls).
- `CombatSystem` — server-authoritative damage. Validates attack range (default 2.0 tiles, skill-overridable), enforces per-skill cooldowns via a `Map<skillId, expiresAt>` per player (generalized from spike's 250ms global clamp, per `PROTOTYPE_NOTES.md` lesson #2), applies damage via `SkillResolver`, manages sticky-attack-target state per player (per `PROTOTYPE_NOTES.md` lesson #1).
- `SkillResolver` — pure function: `(skillId, tripodConfig, casterStats, targetStats, distance) → SkillEffect[]`. Effects are deltas (damage amount, Burn stack add, position teleport, etc.) applied by other systems. This is the deep module that encodes Pyromancy's 12 skills × tripod variants.
- `MobAI` — simple state machine per mob: `idle | aggro | attacking | dead | respawning`. Aggro radius checked each tick. Shallow at alpha; will be replaced for production.
- `SnapshotEncoder` — converts entity state into the wire payload. Two modes: dev-mode JSON (per `PROTOTYPE_NOTES.md` lesson #4) and prod-mode binary. Delta encoding is deferred per `PROTOTYPE_NOTES.md` lesson #3 but the encoder must be designed so delta encoding can be added without changing call sites.

**Persistence** (`apps/server-gateway` and `apps/server-channel` both consume)
- `CharacterRepo`, `InventoryRepo`, `AccountRepo` — Kysely-backed; type-safe SQL.
- `AuditLog` — append-only Postgres table. Every item drop above value threshold, every trade (post-alpha), every vendor transaction, every account-level action writes a row.
- `SnapshotWorker` — background job that flushes session state (position, HP, equipped loadout) every 30 seconds and on zone transitions, per ADR-0013.

### Domain modules to build (`packages/domain`)
- `DisciplineSchema` — data-driven definitions of all 12 Pyromancy skills (cost, base cooldown, range, animation, base damage formula) + tripod options per skill + 20-node passive tree. Blademaster gets a reduced-fidelity slate (3–4 skills enough to validate the 2-discipline mixing system). Other 4 disciplines exist as schema stubs only.
- `ItemSchema` — affix pool (stat affixes + skill affixes), tier table, base item bases (weapons, armor slots), per-mob drop tables.
- `StatCalculator` — pure function: `(equippedItems, passiveAllocations, disciplineLevels) → CharacterStats`. Stats include the 4 D2 primaries (STR/DEX/INT/VIT) + derived (HP, Spirit cap, regen rates, crit, damage modifiers per damage type).
- `DropTable` — pure function: `(mobId, magicFind, zoneModifiers) → ItemInstance[]`. Server-issued UUIDs per ADR-0013.
- `TappingService` — pure rule logic + DB transaction. Single interface: `attemptRefinement(itemId, materials, accountId) → { outcome: 'success' | 'failure', newRefinement, pityCounter }`. Pity counter persisted on the item row.

### Protocol (`packages/protocol`)
- Message types: `Hello`, `Welcome`, `Move`, `Attack`, `SkillCast`, `Snapshot`, `EntitySpawn`, `EntityDespawn`, `Chat`, `Error`.
- Binary encoder/decoder over WebSocket. JSON dev-mode flag toggles which encoder is used. Wire-format-versioned via a magic byte to allow future schema evolution.

### Client modules to build (`apps/client`)
- `GatewayClient` — HTTP handshake against the gateway. Returns `{ wsUrl, sessionToken, characterId }`.
- `ChannelClient` — WebSocket to the channel process. Reconnect with backoff. Surfaces a typed message stream to the rest of the client.
- `SnapshotInterpolator` — buffers incoming snapshots, smooths render positions between them (12Hz convergence per prototype). Single interface: `interpolateAt(t) → EntityState[]`.
- `IsoRenderer` — screen↔world coordinate math, depth sort by y, sprite layer management. PixiJS-backed.
- `EntityRenderer` — per-entity sprite + animation state (idle / walking / casting / dying).
- `VFXRenderer` — particles, telegraphs, floating damage numbers.
- `TerrainRenderer` — tile map.
- `InputController` — mouse-driven movement, skill bar key bindings (6 keys, exact bindings TBD per ADR-0003), sticky attack target state machine.
- `HUD` — plain DOM (no framework) per ADR-0012. HP/Spirit/Wrath bars, cooldown overlays, target frame, buff/debuff icons.
- Solid.js UI panels: `InventoryPanel`, `CharacterSheet`, `VendorPanel`, `SkillBarConfigPanel` (with tripod selectors), `PassiveTreePanel`.

### Architectural decisions inherited from ADRs
- Tick rate 20Hz per channel.
- Channel cap 50 (open world) / 100 (Hold Veridian).
- One OS process per channel per ADR-0011 — no multiplexing.
- Two-tier persistence (write-through high-value events, 30s snapshot for session) per ADR-0013.
- Stats sourced from gear + passives + discipline level only — no manual allocation per ADR-0006.
- Spirit + Wrath two-resource model per ADR-0010.
- 6-of-24 free-pick hotbar slots per ADR-0003 (amended) and ADR-0018.

### Decision: sticky attack target shape (encoded by prototype lesson)

Per `PROTOTYPE_NOTES.md` lesson #1, the prototype omitted sticky-attack-target and it was immediately annoying. The real shape:

```
PlayerAttackState =
  | { kind: 'idle' }
  | { kind: 'chasing', targetEntityId: EntityId, skillId: SkillId }
  | { kind: 'in-range-attacking', targetEntityId: EntityId, skillId: SkillId }

transitions:
  click-on-mob(m, skillId) → chasing(m, skillId)
  tick if chasing and distance(player, m) <= skillRange(skillId) → in-range-attacking
  tick if in-range-attacking and cooldown ready → cast skillId at m, stay in in-range-attacking
  tick if target dies or out-of-LOS → idle
  click-on-ground → idle (with optional pending move)
```

`CombatSystem` owns this state per player. `MovementSystem` reads it to decide whether to keep moving (chasing) or stand still (in-range-attacking).

### Schema notes (Postgres, single DB per ADR-0013)
- `accounts(id, discord_id, email, password_hash, created_at)`
- `characters(id, account_id, name, created_at, last_login_at, snapshot_state JSONB)`
- `items(id UUID server-issued, owner_character_id, base_id, affixes JSONB, refinement INT, pity_counter INT, created_at)`
- `inventory(character_id, slot, item_id)`
- `equipped(character_id, gear_slot, item_id)`
- `passive_allocations(character_id, discipline_id, node_id)`
- `audit_log(id, account_id, action_type, payload JSONB, created_at)` — append-only.
- `disciplines_learned(character_id, discipline_id, learned_at)` — driven by trainer quest completion.

### Channel routing (Redis-backed)
- Key: `channel:zone:{zoneId}` → set of `{ channelId, processUrl, currentLoad }`.
- Gateway reads on every connection request; writes when channels spin up / shut down.
- Channel processes heartbeat their load every 5 seconds.

## Testing Decisions

### What makes a good test
- Tests target external behavior (inputs → outputs / state changes), not implementation details.
- Pure logic gets pure unit tests with no test doubles.
- Stateful systems (CombatSystem, MovementSystem) get tests against an in-memory `ZoneState` — no DB needed.
- Persistence gets integration tests against a real Postgres (spun up per test suite or shared via a transactional rollback).
- The full loop gets at least one Playwright test that covers the canonical user journey.

### Modules to test in alpha (per user-confirmed scope)
- **Pure logic** (Vitest unit tests): `StatCalculator`, `SkillResolver`, `DropTable`, `TappingService`, protocol encoder/decoder round-trip. Highest ROI — no test doubles, easy to maintain.
- **Server-authoritative validators** (Vitest integration against in-memory `ZoneState`): `MovementSystem` (bounds + speed + tile-collision), `CombatSystem` (range, per-skill cooldown enforcement, sticky-target FSM transitions), `ChannelRouter` (capacity logic, spin-up rules).
- **Persistence + repos** (Vitest integration against real Postgres): `CharacterRepo`, `InventoryRepo`, `AccountRepo`, `AuditLog`. Confirms Kysely query shape, schema drift, transaction correctness.
- **End-to-end Playwright**: at least one full-loop test: launch dev gateway + channel + client → headless browser connects → walks → attacks → kills mob → picks up item → equips it → stat update visible on character sheet.

### Prior art for tests
- Codebase has no test prior art yet. Test conventions established in this PRD become the canonical pattern.
- Vitest config inherited from default; co-located `.test.ts` files next to the modules they test.
- Playwright config under `apps/client` with a `e2e/` directory; tests start their own gateway + channel via the existing `pnpm dev` script or a dedicated `pnpm test:e2e` task.

## Out of Scope

- **PvP** — no dueling, no arena, no world PvP. Per ADR-0009.
- **Trials** — the 4–8-player scheduled raid pillar. Post-alpha.
- **Auction House** — vendor only. Player-to-player trading is also post-alpha.
- **Orders (guilds)** — no Order structure, no Order chat, no Order tag.
- **Party system beyond ad-hoc 2-player** — no Party Finder, no cross-channel party warping. Alpha supports inviting one nearby player into a "duo" for Rift sharing only.
- **Five-of-six disciplines** — only Pyromancy (full) and Blademaster (reduced) at alpha. Cryomancy, Marksman, Sentinel, Shadowblade are schema stubs.
- **Mailbox** — no in-game mail system.
- **Chat beyond zone-local** — alpha has a single zone-local chat channel only; no Global, Trade, Whisper, or Party chat.
- **Multiple Holds / multiple zones** — one Hold (Hold Veridian) + one open-world zone + one Rift instance. Other zones come post-alpha.
- **Higher Rift tiers** — only T1 Rift. T2–T10 post-alpha.
- **Vigor catchup currency** — full Vigor mechanic deferred to a later PRD covering retention systems.
- **Hardcore mode** — explicitly post-launch additive (per ADR-0008).
- **Seasonal ladder** — explicitly deferred (per glossary).
- **Inscription / runewords** — explicitly deferred (per ADR-0005).
- **Magic Find from consumables / zone modifiers** — alpha exposes MF as a stat but it only exists at a baseline value; consumables and zone-modifier sources of MF come post-alpha.
- **Item set drops** — green-tier set items deferred. White / blue / yellow / unique only at alpha.
- **Cosmetic shop / monetization** — no shop UI at alpha (per ADR-0017 monetization is post-launch).
- **Achievements / leaderboards** — no achievement system; no leaderboards.
- **VFX-per-skill 2-week-per-discipline polish pass** (per ADR-0014) — alpha VFX is "good enough to read" not "shippable polish." Real VFX pass is a separate PRD.
- **Delta-encoded snapshots / area-of-interest filtering** — per `PROTOTYPE_NOTES.md` lesson #3, this lands before the 50-player-channel stress test, but is not required for the alpha vertical slice to be playable. Tracked as a follow-up issue with a hard "must-land-before-stress-test" gate.
- **Hardcoded binary protocol versioning beyond magic byte** — full schema-evolution support deferred until a wire-incompatible change is genuinely needed.

## Further Notes

- The PRD intentionally over-specifies user stories on combat / discipline / itemization (the load-bearing systems) and under-specifies on UI polish, audio, settings, and account-management peripherals. The expectation is that those gaps surface during the `to-issues` breakdown as their own small tickets, not that they're missing from the design.
- The order in which the resulting issues should be tackled is roughly: gateway + channel scaffolding → protocol + snapshot loop → movement + combat systems → discipline schema + skill resolver → itemization + persistence → Hold + zone + Rift content → UI panels → polish + Playwright e2e. The `to-issues` skill is the next step and should respect this ordering when applying issue dependencies.
- Engineering risks flagged but not blocking for the alpha vertical slice:
  - **Snapshot bandwidth** — full-state-per-tick is fine for the alpha's intended ≤10-concurrent-tester volume. Delta encoding lands before the 50-player stress test.
  - **Mob AI** — alpha uses a 4-state FSM that will be replaced for production. Acceptable for proving the loop.
  - **Per-skill cooldown map** — building the right shape from day one (per-skill timestamps, not global) per `PROTOTYPE_NOTES.md` lesson #2.
- Discipline content for the 5 non-Pyromancy disciplines is intentionally not in this PRD. Each will get its own focused PRD that applies the ADR-0018 template (12-skill anatomy + 72 tripods + 20-node tree) to that discipline's identity.
- This PRD is the source-of-truth design artifact for the alpha milestone. Significant design changes (anything that touches an ADR) must update the relevant ADR first; smaller changes append to this PRD's "Further Notes" with a dated entry.
