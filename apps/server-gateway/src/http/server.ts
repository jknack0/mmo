import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AuthService } from '../auth/auth-service.js';
import type { AuthError } from '../auth/types.js';
import type { CharacterService, CharacterError } from '../character/character-service.js';
import type { RedisClient } from '../redis/client.js';
import { requireAccount } from './require-account.js';
import {
  loadTripods,
  saveTripods,
  validateLoadout,
} from '../tripod/tripod-store.js';
import {
  loadPassives,
  savePassives,
  isValidAllocation,
} from '../passive/passive-store.js';
import {
  loadDisciplines,
  saveDisciplines,
  validateEquippedDisciplines,
} from '../discipline/discipline-store.js';
import { DISCIPLINE_SWITCH_COST } from '@mmo/domain';
import type { InventoryRepo } from '../inventory/inventory-repo.js';
import type { TappingService } from '../tapping/tapping-service.js';
import type { VendorService } from '../vendor/vendor-service.js';
import type { RespawnService } from '../respawn/respawn-service.js';
import type { AuditRepo } from '../audit/audit-repo.js';
import type { ChannelRouter } from '../channel-router/channel-router.js';
import type { QuestRepo } from '../quest/quest-repo.js';
import {
  getItemBase,
  slotAcceptsBase,
  aggregateEquipped,
  computeDerivedStats,
  VENDOR_CATALOG,
  validateLearnedEquip,
  TRAINER_QUESTS,
  getQuest,
  initialProgress,
  startQuest,
  recordQuestKill,
  turnInQuest,
} from '@mmo/domain';

export interface GatewayServerOptions {
  auth: AuthService;
  characters: CharacterService;
  redis: RedisClient;
  inventory: InventoryRepo;
  tapping: TappingService;
  vendor: VendorService;
  /** Respawn economy (S18). Optional so legacy test harnesses can omit it. */
  respawn?: RespawnService;
  /** Audit trail (S21). Records high-value allocation events. Optional. */
  audit?: AuditRepo;
  /** Trainer quests + learned-discipline gate (S12). When present, equip is
   * gated on the learned set and the quest routes are served. Optional. */
  quests?: QuestRepo;
  /** ChannelRouter (S04). When present, /connect routes by zone + capacity. */
  router?: ChannelRouter;
  /** Origin the client SPA is served from. Discord callback redirects here. */
  clientOrigin: string;
  /** Legacy single-channel WS URL — fallback when no router is configured. */
  channelWsUrl: string;
}

/** Open-world starter zone a /connect defaults to when none is requested. */
const DEFAULT_ZONE_ID = 'ashen-plains';

const AUTH_ERROR_STATUS: Record<AuthError, number> = {
  'invalid-credentials': 401,
  'email-already-exists': 400,
  'weak-password': 400,
  'discord-state-invalid': 400,
  'discord-exchange-failed': 400,
};

const CHARACTER_ERROR_STATUS: Record<CharacterError, number> = {
  'name-taken': 409,
  'name-too-short': 400,
  'name-too-long': 400,
  'name-invalid-chars': 400,
};

const PLAY_PATH = /^\/characters\/([0-9a-f-]{36})\/play$/;
const TRIPOD_PATH = /^\/characters\/([0-9a-f-]{36})\/tripods$/;
const PASSIVE_PATH = /^\/characters\/([0-9a-f-]{36})\/passives$/;
const DISCIPLINE_PATH = /^\/characters\/([0-9a-f-]{36})\/disciplines$/;
const INVENTORY_PATH = /^\/characters\/([0-9a-f-]{36})\/inventory$/;
const EQUIP_PATH = /^\/characters\/([0-9a-f-]{36})\/equip$/;
const UNEQUIP_PATH = /^\/characters\/([0-9a-f-]{36})\/unequip$/;
const TAP_PATH = /^\/characters\/([0-9a-f-]{36})\/items\/([0-9a-f-]{36})\/tap$/;
const VENDOR_BUY_PATH = /^\/characters\/([0-9a-f-]{36})\/vendor\/buy$/;
const VENDOR_SELL_PATH = /^\/characters\/([0-9a-f-]{36})\/vendor\/sell$/;
const RESPAWN_PATH = /^\/characters\/([0-9a-f-]{36})\/respawn$/;
const QUESTS_PATH = /^\/characters\/([0-9a-f-]{36})\/quests$/;
const QUEST_START_PATH = /^\/characters\/([0-9a-f-]{36})\/quests\/([a-z-]+)\/start$/;
const QUEST_KILL_PATH = /^\/characters\/([0-9a-f-]{36})\/quests\/([a-z-]+)\/kill$/;
const QUEST_TURNIN_PATH = /^\/characters\/([0-9a-f-]{36})\/quests\/([a-z-]+)\/turn-in$/;

function setCors(res: ServerResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.end();
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

export function buildGatewayServer(opts: GatewayServerOptions): Server {
  const { auth, characters, clientOrigin, channelWsUrl, redis, inventory, tapping, vendor, router, respawn, audit, quests } = opts;

  // Snapshot the inventory view a vendor trade returns: refreshed carried items,
  // gold, and materials so the client re-renders in one round trip.
  async function vendorView(characterId: string) {
    const [carried, gold, materials] = await Promise.all([
      inventory.listInventory(characterId),
      inventory.getGold(characterId),
      inventory.getMaterials(characterId),
    ]);
    return { inventory: carried, gold, materials };
  }

  // Compute the character's attribute sheet from currently-equipped items
  // (base stats + stat affixes), plus the Magic Find baseline (S14).
  async function attributeSheet(characterId: string) {
    const instances = await inventory.equippedInstances(characterId);
    const stats = computeDerivedStats({}, { itemStats: aggregateEquipped(instances) });
    return { attributes: stats.attributes, armor: stats.armor, magicFind: stats.magicFind };
  }

  return createServer(async (req, res) => {
    try {
      setCors(res, clientOrigin);

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', 'http://localhost');

      // ─── POST /auth/email/register ────────────────────────────
      if (req.method === 'POST' && url.pathname === '/auth/email/register') {
        const body = await readJsonBody<{ email?: string; password?: string }>(req);
        if (!body.email || !body.password) {
          sendJson(res, 400, { error: 'missing-fields' });
          return;
        }
        const outcome = await auth.authenticate({
          kind: 'email-register',
          email: body.email,
          password: body.password,
        });
        if (outcome.ok) {
          sendJson(res, 200, {
            sessionToken: outcome.sessionToken,
            accountId: outcome.accountId,
          });
        } else {
          sendJson(res, AUTH_ERROR_STATUS[outcome.error], { error: outcome.error });
        }
        return;
      }

      // ─── POST /auth/email/login ───────────────────────────────
      if (req.method === 'POST' && url.pathname === '/auth/email/login') {
        const body = await readJsonBody<{ email?: string; password?: string }>(req);
        if (!body.email || !body.password) {
          sendJson(res, 400, { error: 'missing-fields' });
          return;
        }
        const outcome = await auth.authenticate({
          kind: 'email-login',
          email: body.email,
          password: body.password,
        });
        if (outcome.ok) {
          sendJson(res, 200, {
            sessionToken: outcome.sessionToken,
            accountId: outcome.accountId,
          });
        } else {
          sendJson(res, AUTH_ERROR_STATUS[outcome.error], { error: outcome.error });
        }
        return;
      }

      // ─── GET /auth/discord/start ──────────────────────────────
      if (req.method === 'GET' && url.pathname === '/auth/discord/start') {
        const { url: discordUrl } = await auth.generateDiscordOAuthStart();
        redirect(res, discordUrl);
        return;
      }

      // ─── GET /auth/discord/callback ───────────────────────────
      if (req.method === 'GET' && url.pathname === '/auth/discord/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (!code || !state) {
          redirect(res, `${clientOrigin}/?error=missing-discord-params`);
          return;
        }
        const outcome = await auth.authenticate({ kind: 'discord-code', code, state });
        if (outcome.ok) {
          const target = new URL(clientOrigin);
          target.searchParams.set('session', outcome.sessionToken);
          redirect(res, target.toString());
        } else {
          const target = new URL(clientOrigin);
          target.searchParams.set('error', outcome.error);
          redirect(res, target.toString());
        }
        return;
      }

      // ─── GET /me ──────────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/me') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        sendJson(res, 200, { accountId: session.accountId });
        return;
      }

      // ─── GET /characters ──────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/characters') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const list = await characters.listCharacters(session.accountId);
        sendJson(res, 200, { characters: list });
        return;
      }

      // ─── POST /characters ─────────────────────────────────────
      if (req.method === 'POST' && url.pathname === '/characters') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const body = await readJsonBody<{ name?: string }>(req);
        if (!body.name) {
          sendJson(res, 400, { error: 'missing-fields' });
          return;
        }
        const outcome = await characters.createCharacter(session.accountId, body.name);
        if (outcome.ok) {
          sendJson(res, 201, { character: outcome.character });
        } else {
          sendJson(res, CHARACTER_ERROR_STATUS[outcome.error], { error: outcome.error });
        }
        return;
      }

      // ─── POST /connect ────────────────────────────────────────
      if (req.method === 'POST' && url.pathname === '/connect') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const body = await readJsonBody<{
          characterId?: string;
          zoneId?: string;
          channelId?: string;
        }>(req);
        if (!body.characterId) {
          sendJson(res, 400, { error: 'missing-fields' });
          return;
        }
        const character = await characters.loadCharacter(
          session.accountId,
          body.characterId
        );
        if (!character) {
          sendJson(res, 404, { error: 'character-not-found' });
          return;
        }
        const characterInfo = { id: character.id, name: character.name };

        // S04: route by zone + capacity through the ChannelRouter. `channelId`
        // in the body is a manual channel-switch request (preferred channel).
        if (router) {
          const zoneId = body.zoneId ?? DEFAULT_ZONE_ID;
          const route = await router.routeToChannel(zoneId, session.accountId, {
            preferred: body.channelId,
          });
          if ('error' in route) {
            const status = route.error === 'preferred-full' ? 409 : 503;
            sendJson(res, status, { error: route.error });
            return;
          }
          sendJson(res, 200, {
            wsUrl: route.wsUrl,
            channelId: route.channelId,
            zoneId,
            character: characterInfo,
          });
          return;
        }

        // Legacy fallback: single hardcoded channel.
        sendJson(res, 200, {
          wsUrl: channelWsUrl,
          channelId: 'alpha-test-zone-ch0',
          character: characterInfo,
        });
        return;
      }

      // ─── POST /characters/:id/play ────────────────────────────
      if (req.method === 'POST') {
        const playMatch = PLAY_PATH.exec(url.pathname);
        if (playMatch) {
          const session = await requireAccount(req, res, auth);
          if (!session) return;
          const characterId = playMatch[1]!;
          const character = await characters.loadCharacter(session.accountId, characterId);
          if (!character) {
            sendJson(res, 404, { error: 'character-not-found' });
            return;
          }
          sendJson(res, 200, { character });
          return;
        }
      }

      // ─── GET/PUT /characters/:id/tripods ──────────────────────
      const tripodMatch = TRIPOD_PATH.exec(url.pathname);
      if (tripodMatch && (req.method === 'GET' || req.method === 'PUT')) {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const characterId = tripodMatch[1]!;
        const character = await characters.loadCharacter(session.accountId, characterId);
        if (!character) {
          sendJson(res, 404, { error: 'character-not-found' });
          return;
        }
        if (req.method === 'GET') {
          const loadout = await loadTripods(redis, characterId);
          sendJson(res, 200, { loadout });
          return;
        }
        // PUT
        const body = await readJsonBody<{ loadout?: unknown }>(req);
        if (!validateLoadout(body.loadout)) {
          sendJson(res, 400, { error: 'invalid-loadout' });
          return;
        }
        await saveTripods(redis, characterId, body.loadout);
        await audit?.append({ action: 'tripod-set', accountId: session.accountId, characterId });
        sendJson(res, 200, { loadout: body.loadout });
        return;
      }

      // ─── GET/PUT /characters/:id/passives ─────────────────────
      const passiveMatch = PASSIVE_PATH.exec(url.pathname);
      if (passiveMatch && (req.method === 'GET' || req.method === 'PUT')) {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const characterId = passiveMatch[1]!;
        const character = await characters.loadCharacter(session.accountId, characterId);
        if (!character) {
          sendJson(res, 404, { error: 'character-not-found' });
          return;
        }
        if (req.method === 'GET') {
          const allocation = await loadPassives(redis, characterId);
          sendJson(res, 200, { allocation });
          return;
        }
        // PUT — validateAllocation (via isValidAllocation) enforces prereq
        // gating + the shared 20-point pool before persisting.
        const body = await readJsonBody<{ allocation?: unknown }>(req);
        if (!isValidAllocation(body.allocation)) {
          sendJson(res, 400, { error: 'invalid-allocation' });
          return;
        }
        await savePassives(redis, characterId, body.allocation);
        await audit?.append({
          action: 'passive-alloc',
          accountId: session.accountId,
          characterId,
          detail: { points: Object.values(body.allocation as Record<string, number>).reduce((a, b) => a + b, 0) },
        });
        sendJson(res, 200, { allocation: body.allocation });
        return;
      }

      // ─── GET/PUT /characters/:id/disciplines (S11) ────────────
      const discMatch = DISCIPLINE_PATH.exec(url.pathname);
      if (discMatch && (req.method === 'GET' || req.method === 'PUT')) {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const characterId = discMatch[1]!;
        const character = await characters.loadCharacter(session.accountId, characterId);
        if (!character) {
          sendJson(res, 404, { error: 'character-not-found' });
          return;
        }
        if (req.method === 'GET') {
          sendJson(res, 200, { equipped: await loadDisciplines(redis, characterId) });
          return;
        }
        // PUT — switching disciplines costs gold and clears the passive
        // allocation (ADR-0004: a fresh tree per loadout).
        const body = await readJsonBody<{ equipped?: unknown }>(req);
        if (!validateEquippedDisciplines(body.equipped)) {
          sendJson(res, 400, { error: 'invalid-disciplines' });
          return;
        }
        // S12: gate on the learned set — a player can only equip disciplines
        // they have unlocked via the trainer quest (Pyromancy is the starter).
        if (quests) {
          const learned = await quests.listLearned(characterId);
          if (!validateLearnedEquip(body.equipped, learned)) {
            sendJson(res, 403, { error: 'discipline-not-learned' });
            return;
          }
        }
        const paid = await inventory.spendGold(characterId, DISCIPLINE_SWITCH_COST);
        if (!paid) {
          sendJson(res, 400, { error: 'insufficient-gold' });
          return;
        }
        await saveDisciplines(redis, characterId, body.equipped);
        await savePassives(redis, characterId, {}); // dropped allocation, per ADR-0004
        await audit?.append({
          action: 'discipline-set',
          accountId: session.accountId,
          characterId,
          detail: { equipped: body.equipped, cost: DISCIPLINE_SWITCH_COST },
        });
        sendJson(res, 200, { equipped: body.equipped, gold: await inventory.getGold(characterId) });
        return;
      }

      // ─── Trainer quests (S12 #14) ─────────────────────────────
      // GET  /characters/:id/quests             → quest log + learned set
      // POST /characters/:id/quests/:qid/start  → NotStarted → InProgress
      // POST /characters/:id/quests/:qid/kill   → count a qualifying kill
      // POST /characters/:id/quests/:qid/turn-in→ ReadyToTurnIn → Completed (learn)
      if (quests) {
        const questsMatch = QUESTS_PATH.exec(url.pathname);
        if (questsMatch && req.method === 'GET') {
          const session = await requireAccount(req, res, auth);
          if (!session) return;
          const characterId = questsMatch[1]!;
          if (!(await characters.loadCharacter(session.accountId, characterId))) {
            sendJson(res, 404, { error: 'character-not-found' });
            return;
          }
          const [progress, learned] = await Promise.all([
            quests.listProgress(characterId),
            quests.listLearned(characterId),
          ]);
          const byId = new Map(progress.map((p) => [p.questId, p]));
          const log = TRAINER_QUESTS.map((q) => {
            const p = byId.get(q.id) ?? initialProgress(q.id);
            return {
              id: q.id, name: q.name, trainerId: q.trainerId, discipline: q.discipline,
              mobKind: q.mobKind, killTarget: q.killTarget, state: p.state, kills: p.kills,
            };
          });
          sendJson(res, 200, { quests: log, learned });
          return;
        }

        const startMatch = QUEST_START_PATH.exec(url.pathname);
        const killMatch = QUEST_KILL_PATH.exec(url.pathname);
        const turnInMatch = QUEST_TURNIN_PATH.exec(url.pathname);
        const action = startMatch ? 'start' : killMatch ? 'kill' : turnInMatch ? 'turn-in' : null;
        const match = startMatch ?? killMatch ?? turnInMatch;
        if (match && action && req.method === 'POST') {
          const session = await requireAccount(req, res, auth);
          if (!session) return;
          const characterId = match[1]!;
          const questId = match[2]!;
          if (!(await characters.loadCharacter(session.accountId, characterId))) {
            sendJson(res, 404, { error: 'character-not-found' });
            return;
          }
          const quest = getQuest(questId);
          if (!quest) {
            sendJson(res, 404, { error: 'quest-not-found' });
            return;
          }
          const progress = await quests.loadProgress(characterId, questId);

          if (action === 'start') {
            const r = startQuest(progress);
            if (!r.ok) { sendJson(res, 409, { error: r.error }); return; }
            await quests.saveProgress(characterId, r.progress);
            sendJson(res, 200, { state: r.progress.state, kills: r.progress.kills });
            return;
          }
          if (action === 'kill') {
            const r = recordQuestKill(progress, quest);
            if (r.changed) await quests.saveProgress(characterId, r.progress);
            sendJson(res, 200, { state: r.progress.state, kills: r.progress.kills, changed: r.changed });
            return;
          }
          // turn-in
          const r = turnInQuest(progress, quest);
          if (!r.ok) { sendJson(res, 409, { error: r.error }); return; }
          await quests.saveProgress(characterId, r.progress);
          await quests.learnDiscipline(characterId, r.learned);
          await audit?.append({
            action: 'quest-complete',
            accountId: session.accountId,
            characterId,
            detail: { questId, learned: r.learned },
          });
          sendJson(res, 200, { state: r.progress.state, learned: r.learned });
          return;
        }
      }

      // ─── GET /characters/:id/inventory ────────────────────────
      const invMatch = INVENTORY_PATH.exec(url.pathname);
      if (invMatch && req.method === 'GET') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const characterId = invMatch[1]!;
        const character = await characters.loadCharacter(session.accountId, characterId);
        if (!character) {
          sendJson(res, 404, { error: 'character-not-found' });
          return;
        }
        const [carried, equipped, sheet, materials, gold] = await Promise.all([
          inventory.listInventory(characterId),
          inventory.listEquipped(characterId),
          attributeSheet(characterId),
          inventory.getMaterials(characterId),
          inventory.getGold(characterId),
        ]);
        sendJson(res, 200, { inventory: carried, equipped, ...sheet, materials, gold });
        return;
      }

      // ─── POST /characters/:id/items/:itemId/tap ───────────────
      const tapMatch = TAP_PATH.exec(url.pathname);
      if (tapMatch && req.method === 'POST') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const characterId = tapMatch[1]!;
        const itemId = tapMatch[2]!;
        const character = await characters.loadCharacter(session.accountId, characterId);
        if (!character) {
          sendJson(res, 404, { error: 'character-not-found' });
          return;
        }
        const result = await tapping.attemptRefinement(itemId, session.accountId);
        if (!result.ok) {
          const status = result.error === 'not-found' ? 404 : 400;
          sendJson(res, status, { error: result.error });
          return;
        }
        sendJson(res, 200, {
          outcome: result.outcome,
          refinement: result.refinement,
          pityCounter: result.pityCounter,
          materials: result.materials,
        });
        return;
      }

      // ─── POST /characters/:id/respawn ─────────────────────────
      const respawnMatch = RESPAWN_PATH.exec(url.pathname);
      if (respawnMatch && req.method === 'POST') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        if (!respawn) {
          sendJson(res, 503, { error: 'respawn-unavailable' });
          return;
        }
        const characterId = respawnMatch[1]!;
        const character = await characters.loadCharacter(session.accountId, characterId);
        if (!character) {
          sendJson(res, 404, { error: 'character-not-found' });
          return;
        }
        const result = await respawn.respawn(characterId, session.accountId);
        sendJson(res, 200, result);
        return;
      }

      // ─── GET /vendor (static catalog) ─────────────────────────
      if (req.method === 'GET' && url.pathname === '/vendor') {
        sendJson(res, 200, { catalog: VENDOR_CATALOG });
        return;
      }

      // ─── POST /characters/:id/vendor/buy ──────────────────────
      const buyMatch = VENDOR_BUY_PATH.exec(url.pathname);
      if (buyMatch && req.method === 'POST') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const characterId = buyMatch[1]!;
        const character = await characters.loadCharacter(session.accountId, characterId);
        if (!character) {
          sendJson(res, 404, { error: 'character-not-found' });
          return;
        }
        const body = await readJsonBody<{ baseId?: string }>(req);
        if (!body.baseId) {
          sendJson(res, 400, { error: 'missing-fields' });
          return;
        }
        const result = await vendor.buy(characterId, session.accountId, body.baseId);
        if (!result.ok) {
          sendJson(res, 400, { error: result.reason });
          return;
        }
        sendJson(res, 200, { ...(await vendorView(characterId)) });
        return;
      }

      // ─── POST /characters/:id/vendor/sell ─────────────────────
      const sellMatch = VENDOR_SELL_PATH.exec(url.pathname);
      if (sellMatch && req.method === 'POST') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const characterId = sellMatch[1]!;
        const character = await characters.loadCharacter(session.accountId, characterId);
        if (!character) {
          sendJson(res, 404, { error: 'character-not-found' });
          return;
        }
        const body = await readJsonBody<{ itemId?: string }>(req);
        if (!body.itemId) {
          sendJson(res, 400, { error: 'missing-fields' });
          return;
        }
        const result = await vendor.sell(characterId, session.accountId, body.itemId);
        if (!result.ok) {
          sendJson(res, 400, { error: result.reason });
          return;
        }
        sendJson(res, 200, { value: result.value, ...(await vendorView(characterId)) });
        return;
      }

      // ─── POST /characters/:id/equip ───────────────────────────
      const equipMatch = EQUIP_PATH.exec(url.pathname);
      if (equipMatch && req.method === 'POST') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const characterId = equipMatch[1]!;
        const character = await characters.loadCharacter(session.accountId, characterId);
        if (!character) {
          sendJson(res, 404, { error: 'character-not-found' });
          return;
        }
        const body = await readJsonBody<{ itemId?: string; gearSlot?: string }>(req);
        if (!body.itemId || !body.gearSlot) {
          sendJson(res, 400, { error: 'missing-fields' });
          return;
        }
        // The item must be carried, and its base must fit the requested slot.
        const carried = await inventory.listInventory(characterId);
        const entry = carried.find((e) => e.itemId === body.itemId);
        if (!entry) {
          sendJson(res, 400, { error: 'not-in-inventory' });
          return;
        }
        const base = getItemBase(entry.baseId);
        if (!base || !slotAcceptsBase(body.gearSlot, base.slot)) {
          sendJson(res, 400, { error: 'invalid-slot' });
          return;
        }
        const result = await inventory.equip(characterId, body.itemId, body.gearSlot);
        if (!result.ok) {
          sendJson(res, 400, { error: result.reason });
          return;
        }
        const [carried2, equipped, sheet] = await Promise.all([
          inventory.listInventory(characterId),
          inventory.listEquipped(characterId),
          attributeSheet(characterId),
        ]);
        sendJson(res, 200, { inventory: carried2, equipped, ...sheet });
        return;
      }

      // ─── POST /characters/:id/unequip ─────────────────────────
      const unequipMatch = UNEQUIP_PATH.exec(url.pathname);
      if (unequipMatch && req.method === 'POST') {
        const session = await requireAccount(req, res, auth);
        if (!session) return;
        const characterId = unequipMatch[1]!;
        const character = await characters.loadCharacter(session.accountId, characterId);
        if (!character) {
          sendJson(res, 404, { error: 'character-not-found' });
          return;
        }
        const body = await readJsonBody<{ gearSlot?: string }>(req);
        if (!body.gearSlot) {
          sendJson(res, 400, { error: 'missing-fields' });
          return;
        }
        await inventory.unequip(characterId, body.gearSlot);
        const [carried, equipped, sheet] = await Promise.all([
          inventory.listInventory(characterId),
          inventory.listEquipped(characterId),
          attributeSheet(characterId),
        ]);
        sendJson(res, 200, { inventory: carried, equipped, ...sheet });
        return;
      }

      // ─── GET /health ──────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: 'not-found' });
    } catch (err) {
      console.error('[gateway] handler error:', err);
      sendJson(res, 500, { error: 'internal' });
    }
  });
}
