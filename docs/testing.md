# Testing Conventions (S27 #29)

The alpha was built test-first; this is the pattern every future slice follows.
At the milestone, the load-bearing tiers measure:

| Tier | Mean line coverage | Bar |
|------|--------------------|-----|
| Pure logic (`packages/domain`, `packages/protocol`) | ~98% | ≥80% |
| Server-authoritative validators (combat, zone/movement, channel-router) | ~97% | covered |
| Repos / services (real Postgres) | ~99% | covered |

## Three test tiers

1. **Pure logic — unit, no doubles.** Domain (`StatCalculator`, `DropTable`,
   affixes, refinement, disciplines, quests, rift, respawn, zones) and the
   protocol codec (binary + delta encode/decode) are pure functions. Test them
   with plain Vitest and concrete inputs — no mocks, no I/O. Cover the happy
   path, every branch/keystone, and the error/validation throws.

2. **Server-authoritative validators — integration vs in-memory `ZoneState`.**
   `MovementSystem`, `CombatSystem` (+ FSM/burn/aggro/tripods/passives) and the
   `ChannelRouter` run against a real in-memory zone or a real Redis, never a
   mocked rules engine — the server is the source of truth, so the test drives
   it the way the channel does.

3. **Repos — integration vs real Postgres.** `AccountRepo`, `CharacterRepo`,
   `InventoryRepo`, `AuditRepo`, `QuestRepo` and the services run against the
   `mmo_test` database (and real Redis for stores). No DB doubles.

## Location & naming

- Tests live next to the code: `foo.ts` → `foo.test.ts` (co-located in `src/`).
- HTTP route suites live in `apps/server-gateway/src/http/*-routes.test.ts`.
- WebSocket / channel suites live beside the server in `apps/server-channel/src/`.
- The Playwright e2e lives in `apps/client/e2e/` (excluded from Vitest).

## Fixtures & isolation (shared `mmo_test` / Redis)

- **Postgres:** scope every `DELETE`/`SELECT` to the suite's own account
  (`WHERE email = '<suite>@…'`) or its own character id. Never `DELETE FROM
  accounts` unscoped — it races sibling suites running in parallel workers.
- **Redis:** WS suites that `flushdb` use a dedicated logical db
  (`…/2`, `…/3`, `…/4`, `…/5`, `…/6`) so flushes never clobber another suite.
- Use unique per-run identities (`uniqueEmail()`-style) for anything that
  persists, so reruns don't collide.
- Run from the **repo root** (`pnpm test`) — Vitest is workspace-configured.

## Running

```bash
pnpm test            # full suite (run from repo root)
pnpm test:coverage   # + v8 coverage → ./coverage (text, html, json-summary)
pnpm test:e2e        # Playwright canonical loop (see docs/e2e.md)
```

The coverage report is exportable: `./coverage/index.html` (browsable) and
`./coverage/coverage-summary.json` (machine-readable for CI gates). Coverage
`include`/`exclude` is configured in `vitest.config.ts` — server entrypoints,
migrations, the load-test CLI and the dev-only e2e hook are excluded as they
carry no unit-testable logic.
