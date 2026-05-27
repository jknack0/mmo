# Tech stack: TypeScript end-to-end, PixiJS + Solid.js client, Node channels, Postgres + Redis

## Stack

**Client**
- Language: TypeScript
- Game rendering: PixiJS v8 (in-world entities, damage numbers, telegraphs, nameplates)
- UI rendering: Solid.js (menus, panels, inventory, character sheet, vendor, tooltips, chat)
- HUD (HP/Spirit/Wrath bars, cooldown overlays): plain DOM with direct mutation, no framework
- Styling: Tailwind
- Tooltip/popover positioning: @floating-ui/dom
- State bridge (game ↔ Solid): zustand-equivalent in vanilla TS (or solid-store)
- Build: Vite

**Server**
- Runtime: Node.js + TypeScript (tsx in dev, tsc-built in prod)
- Topology: a single Gateway process handles auth/lobby/character-select/channel-routing; many Channel processes each own a single channel of a single zone. Gateway proxies client websocket connections to the right channel process.
- Tick rate: 20 Hz per channel
- Transport: plain WebSocket with hand-rolled binary protocol (no Socket.IO)
- SQL: Kysely (type-safe SQL builder, not an ORM)

**Data**
- Primary DB: Postgres (accounts, characters, items, inventories, trades, auction house, leaderboards, audit)
- Cache / ephemeral: Redis (sessions, channel-routing table, rate limits, pub/sub for cross-channel notifications, transient leaderboards)

**Auth**
- Primary: Discord OAuth
- Fallback: email + password (bcrypt + secure session)
- No managed auth (no Clerk/Auth0)

**Hosting**
- VPS: Hetzner (or Fly.io) — explicitly NOT AWS, whose pricing kills low-scale MMO economics
- Postgres: self-hosted on the same VPS to start; migrate to managed (Neon, Supabase) when ops becomes painful
- Redis: self-hosted on the same VPS

**Repo**
- pnpm monorepo
- `apps/client` (PixiJS + Solid), `apps/server-gateway`, `apps/server-channel`, `packages/protocol` (shared messages + types), `packages/domain` (shared domain types: items, skills, disciplines)

**Testing**
- Vitest for unit/integration
- Playwright for end-to-end flows
- Custom WebSocket load-test rig for channel-cap stress

## Why

TypeScript end-to-end is the single biggest force-multiplier for solo dev: shared protocol + shared domain types between client and server catch more bugs than any test suite. PixiJS is the right tool for 2D browser rendering. Solid.js for menus gives React-like component ergonomics with no virtual DOM cost — chosen over React because the developer-productivity benefit of React mostly accrues to human authors, and the runtime cost remains regardless. Direct DOM for HUD avoids the most common "I shipped a framework game and it's at 30fps" failure mode. Node + Postgres + Redis is the boring, correct, infinitely-googleable stack — choosing exotic (Rust, Elixir, Bun) would spend novelty-tax time during design-time. Discord OAuth is where the ARPG community lives. Hetzner/Fly.io because cloud bills can kill the project before player count justifies AWS.

## Notable rejections

- **Rust for the channel process**: tempting (200+ players per channel possible), but loses the shared-types win and adds a second language. Reserved as a v2 rewrite if numbers demand it; gateway/auth/DB code stays in Node either way.
- **A game engine (Godot, Defold)**: opinionated patterns conflict with the all-TS-everywhere model.
- **WebTransport**: not in Safari yet; revisit in 12+ months.
- **Bun for the server**: production maturity for long-running channel processes still favors Node. Revisit in 12+ months.
- **An ORM (Prisma, TypeORM, Drizzle)**: ORM cost is real on MMO hot paths. Kysely gives type-safe SQL without the abstraction tax.
- **CSS-in-JS (Styled Components, Emotion)**: runtime overhead, no benefit over Tailwind.
