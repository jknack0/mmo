# End-to-End Test (S26 #28)

`apps/client/e2e/alpha-loop.spec.ts` is the canonical regression guardrail for the
whole alpha loop, driven through a real headless Chromium:

> register (email fallback) → create character → connect → walk → attack → kill →
> **loot** → equip → character sheet updates → inventory panel renders.

Gameplay is driven through a deterministic `window.__mmoE2E` hook
(`apps/client/src/e2e-hook.ts`, dev-only) so the test never depends on canvas
pixel coordinates. The email/password path is used (not Discord OAuth) for
determinism, and the channel runs with `CHANNEL_FORCE_DROP=1` so the killed mob
always drops lootable gear.

## Prerequisites

- Postgres + Redis up (`docker compose up -d`) and migrated
  (`pnpm --filter @mmo/server-gateway migrate`).
- Playwright browser installed (`pnpm --filter @mmo/client exec playwright install chromium`).

## Running

```bash
# Boots gateway + ashen channel + vite client automatically (playwright.config.ts).
pnpm --filter @mmo/client test:e2e

# Or against an already-running stack:
E2E_SKIP_WEBSERVER=1 pnpm --filter @mmo/client test:e2e
```

The `webServer` block starts:
1. the gateway (`:8080`),
2. the ashen-plains channel (`:8081`, `CHANNEL_FORCE_DROP=1`),
3. the vite client (`:5173`),

reusing any already-listening server. **Caveat:** a stale channel left running
*without* `CHANNEL_FORCE_DROP` will be reused and break the loot step — stop
leftover dev servers before a clean run.

## Fixtures

`apps/client/e2e/fixtures.ts` provides `uniqueEmail()` / `uniqueName()` (so runs
never collide on the shared dev DB) and `registerCreatePlay(page)` (the
account → character → in-world bring-up).

## CI hook (documented, not wired)

```yaml
# .github/workflows/e2e.yml  (illustrative)
e2e:
  runs-on: ubuntu-latest
  services:
    postgres: { image: postgres:16, env: { POSTGRES_USER: mmo, POSTGRES_PASSWORD: mmo, POSTGRES_DB: mmo_test }, ports: ['5432:5432'] }
    redis:    { image: redis:7, ports: ['6379:6379'] }
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @mmo/server-gateway migrate
    - run: pnpm --filter @mmo/client exec playwright install --with-deps chromium
    - run: pnpm --filter @mmo/client test:e2e
```
