import { test, expect } from '@playwright/test';
import { registerCreatePlay } from './fixtures.js';


// The canonical alpha-loop regression guardrail (S26 #28):
//   register → create character → connect → walk → attack → kill → loot →
//   equip → character sheet updates.
// Gameplay is driven through the deterministic window.__mmoE2E hook so the test
// never depends on canvas pixel coordinates. Loot is deterministic because the
// channel runs with CHANNEL_FORCE_DROP=1 (see playwright.config.ts).
test('canonical alpha loop: connect → walk → attack → kill → loot → equip', async ({ page }) => {
  await registerCreatePlay(page);

  // Wait for the first reconstructed snapshot carrying the local player + a mob.
  await page.waitForFunction(() => {
    const s = (window as any).__mmoE2E?.controls?.getState?.();
    return !!s?.me && (s.mobs?.length ?? 0) > 0;
  }, null, { timeout: 20_000 });

  // ── Walk to the nearest mob and attack until it dies ──────────────
  const killedId = await page.evaluate(async () => {
    const api = (window as any).__mmoE2E.controls;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const nearestAlive = () => {
      const s = api.getState();
      const alive = s.mobs.filter((m: any) => m.alive);
      if (!alive.length || !s.me) return null;
      alive.sort((a: any, b: any) =>
        Math.hypot(a.pos.x - s.me.pos.x, a.pos.y - s.me.pos.y) -
        Math.hypot(b.pos.x - s.me.pos.x, b.pos.y - s.me.pos.y));
      return alive[0];
    };
    const target = nearestAlive();
    if (!target) return null;
    const id = target.id;
    for (let i = 0; i < 150; i++) {
      const m = api.getState().mobs.find((x: any) => x.id === id);
      if (!m || !m.alive) return id;     // killed
      api.move(m.pos);                   // keep closing the gap
      api.attack(id, 'basic-attack');    // sticky-FSM auto-fires server-side
      await sleep(150);
    }
    const m = api.getState().mobs.find((x: any) => x.id === id);
    return (!m || !m.alive) ? id : null;
  });
  expect(killedId, 'a mob should be killed within the timeout').toBeTruthy();

  // ── Loot: the forced drop appears on the ground; walk onto it to pick up ──
  const looted = await page.evaluate(async () => {
    const api = (window as any).__mmoE2E.controls;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 100; i++) {
      const s = api.getState();
      if (s.ground.length && s.me) api.move(s.ground[0].pos); // walk-over auto-pickup
      await sleep(150);
      if (i > 3 && api.getState().ground.length === 0) {
        // ground cleared → grabbed (or never spawned); confirm via inventory below
        break;
      }
    }
    const { sessionToken, characterId } = (window as any).__mmoE2E;
    const inv = await (await fetch(`http://localhost:8080/characters/${characterId}/inventory`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    })).json();
    return { count: inv.inventory.length };
  }).then((r) => r);
  expect(looted.count, 'the killed mob should have dropped lootable into the bag').toBeGreaterThan(0);

  // ── Equip the looted item and assert the character sheet changes ──
  const equip = await page.evaluate(async () => {
    const { sessionToken, characterId } = (window as any).__mmoE2E;
    const headers = { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' };
    const before = await (await fetch(`http://localhost:8080/characters/${characterId}/inventory`, { headers })).json();
    const item = before.inventory[0];
    const sheetBefore = JSON.stringify({ attributes: before.attributes, armor: before.armor });
    const slots = ['weapon', 'off-hand', 'head', 'chest', 'legs', 'feet', 'hands', 'ring-1', 'ring-2', 'neck'];
    let equipped = false;
    for (const gearSlot of slots) {
      const res = await fetch(`http://localhost:8080/characters/${characterId}/equip`, {
        method: 'POST', headers, body: JSON.stringify({ itemId: item.itemId, gearSlot }),
      });
      if (res.ok) { equipped = true; break; }
    }
    const after = await (await fetch(`http://localhost:8080/characters/${characterId}/inventory`, { headers })).json();
    return {
      equipped,
      beforeEquippedCount: before.equipped.length,
      afterEquippedCount: after.equipped.length,
      sheetChanged: sheetBefore !== JSON.stringify({ attributes: after.attributes, armor: after.armor }),
    };
  });
  expect(equip.equipped, 'the looted item should equip into a valid slot').toBe(true);
  expect(equip.afterEquippedCount).toBeGreaterThan(equip.beforeEquippedCount);
  expect(equip.sheetChanged, 'equipping should change the character sheet stats').toBe(true);

  // ── The in-game Inventory panel renders the loot (DOM smoke check) ──
  await page.getByRole('button', { name: /^inventory$/i }).click();
  await expect(page.getByRole('button', { name: /^close$/i }).first()).toBeVisible();
});
