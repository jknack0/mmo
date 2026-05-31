import type { Page } from '@playwright/test';

/** Unique-per-run identity so the e2e never collides on the shared dev DB. */
export function uniqueEmail(): string {
  return `e2e+${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
}
export function uniqueName(): string {
  return `Hero${Date.now() % 1_000_000}`;
}

/** The current app phase published by the client e2e hook (e2e-hook.ts). */
export async function currentPhase(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as unknown as { __mmoE2E?: { phase?: string } }).__mmoE2E?.phase);
}

/** Register a fresh account via the email fallback and create + play a character. */
export async function registerCreatePlay(page: Page): Promise<void> {
  await page.goto('/?e2e=1');

  // Switch to register mode, then submit credentials.
  await page.getByRole('button', { name: /create one/i }).click();
  await page.locator('input[type=email]').fill(uniqueEmail());
  await page.locator('input[type=password]').fill('password-e2e-1');
  await page.getByRole('button', { name: /^create account$/i }).click();

  // Character select → create + enter.
  await page.waitForFunction(() => (window as unknown as { __mmoE2E?: { phase?: string } }).__mmoE2E?.phase === 'character', null, { timeout: 20_000 });
  const createNew = page.getByRole('button', { name: /create new character/i });
  if (await createNew.isVisible().catch(() => false)) await createNew.click();
  await page.locator('input').first().fill(uniqueName());
  await page.getByRole('button', { name: /^create$/i }).click();
  await page.getByRole('button', { name: /^play$/i }).first().click();

  // In world, with the driver hook ready.
  await page.waitForFunction(() => {
    const h = (window as unknown as { __mmoE2E?: { phase?: string; controls?: unknown } }).__mmoE2E;
    return h?.phase === 'world' && !!h.controls;
  }, null, { timeout: 30_000 });
}
