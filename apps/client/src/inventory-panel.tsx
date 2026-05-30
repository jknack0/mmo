// Inventory + equipment panel (S13 #15). Left: the ten gear slots (click an
// equipped item to unequip). Right: the carried grid (click an item to equip
// into the first compatible free slot). Bottom: the character sheet, which
// updates from the server's recomputed StatCalculator output after every move.

import { createSignal, onMount, For, Show, createEffect } from 'solid-js';
import {
  EQUIP_SLOTS,
  getItemBase,
  slotAcceptsBase,
  isConsumable,
  getConsumable,
  itemDisplayName,
  fetchInventory,
  equipItem,
  unequipItem,
  tapItem,
  RARITY_COLOR,
  TAP_COST,
  type InventoryView,
  type InventoryEntry,
  type EquippedEntry,
  type Rarity,
  type RolledAffix,
} from './inventory.js';

export interface InventoryPanelProps {
  token: string;
  characterId: string;
  /** Bump to force a refetch (e.g. after a world pickup). */
  refreshKey: number;
  /** Use a consumable from the bag — sent over the channel (heals in-world). */
  onUse: (itemId: string) => void;
  onClose: () => void;
}

const SLOT_LABEL: Record<string, string> = {
  weapon: 'Weapon',
  'off-hand': 'Off-hand',
  head: 'Head',
  chest: 'Chest',
  legs: 'Legs',
  feet: 'Feet',
  hands: 'Hands',
  'ring-1': 'Ring I',
  'ring-2': 'Ring II',
  neck: 'Neck',
};

function statLine(baseId: string): string {
  const b = getItemBase(baseId);
  if (!b) return '';
  return Object.entries(b.stats)
    .map(([k, v]) => `+${v} ${k}`)
    .join('  ');
}

/** Rarity-colored name + base stats + affix lines (D2-style tooltip body). */
function ItemTooltip(props: { baseId: string; rarity: Rarity; affixes: RolledAffix[]; refinement?: number }) {
  const consumable = () => getConsumable(props.baseId);
  return (
    <>
      <div class="text-sm font-medium" style={{ color: consumable() ? '#5ad17a' : RARITY_COLOR[props.rarity] }}>
        {itemDisplayName(props.baseId)}
        <Show when={(props.refinement ?? 0) > 0}>
          <span class="text-[#ff9f1a] font-bold"> +{props.refinement}</span>
        </Show>
      </div>
      <Show
        when={consumable()}
        fallback={<div class="text-[10px] text-white/45">{statLine(props.baseId)}</div>}
      >
        <div class="text-[11px]" style={{ color: '#7CFC9A' }}>Restores {consumable()!.heal} HP · click to use</div>
      </Show>
      <For each={props.affixes}>
        {(a) => (
          <div
            class="text-[11px]"
            style={{ color: a.kind === 'stat' ? '#9fd2ff' : '#caa8ff' }}
          >
            {a.text}
          </div>
        )}
      </For>
    </>
  );
}

export function InventoryPanel(props: InventoryPanelProps) {
  const [view, setView] = createSignal<InventoryView>({
    inventory: [],
    equipped: [],
    attributes: { str: 0, dex: 0, int: 0, vit: 0 },
    armor: 0,
    magicFind: 0,
    materials: 0,
    gold: 0,
  });
  const [busy, setBusy] = createSignal(false);
  // Tapping: the item awaiting a tap-confirmation, and the last outcome.
  const [tapTarget, setTapTarget] = createSignal<InventoryEntry | null>(null);
  const [tapMsg, setTapMsg] = createSignal<{ text: string; color: string } | null>(null);
  const [tapping, setTapping] = createSignal(false);

  async function onTap(entry: InventoryEntry) {
    if (tapping()) return;
    setTapping(true);
    const r = await tapItem(props.token, props.characterId, entry.itemId);
    setTapping(false);
    setTapTarget(null);
    if (!r.ok) {
      setTapMsg({ text: r.error === 'insufficient-materials' ? 'Not enough materials.' : r.error, color: '#ff6a6a' });
    } else if (r.outcome === 'success') {
      setTapMsg({ text: `Refinement succeeded → +${r.refinement}!`, color: '#7CFC9A' });
    } else if (r.outcome === 'capped') {
      setTapMsg({ text: 'Already at max Refinement for this rarity.', color: '#ffd24a' });
    } else {
      setTapMsg({ text: 'Tap failed — materials lost, item safe.', color: '#ff9f6a' });
    }
    await refresh();
  }

  async function refresh() {
    setView(await fetchInventory(props.token, props.characterId));
  }
  onMount(refresh);
  // Refetch whenever the world reports a pickup.
  createEffect(() => {
    props.refreshKey;
    void refresh();
  });

  const equippedBySlot = () => {
    const m = new Map<string, EquippedEntry>();
    for (const e of view().equipped) m.set(e.gearSlot, e);
    return m;
  };

  /** First compatible slot that's free, else the first compatible slot (swap). */
  function targetSlot(baseId: string): string | null {
    const base = getItemBase(baseId);
    if (!base) return null;
    const occupied = equippedBySlot();
    const compatible = EQUIP_SLOTS.filter((s) => slotAcceptsBase(s, base.slot));
    return compatible.find((s) => !occupied.has(s)) ?? compatible[0] ?? null;
  }

  async function onEquip(itemId: string, baseId: string) {
    const slot = targetSlot(baseId);
    if (!slot || busy()) return;
    setBusy(true);
    const next = await equipItem(props.token, props.characterId, itemId, slot);
    if (next) setView(next);
    setBusy(false);
  }

  async function onUnequip(gearSlot: string) {
    if (busy()) return;
    setBusy(true);
    const next = await unequipItem(props.token, props.characterId, gearSlot);
    if (next) setView(next);
    setBusy(false);
  }

  // Consumables resolve over the channel (the heal lands on the in-world player).
  // Optimistically drop the item from the bag; the server's `consumed` ack bumps
  // refreshKey to reconcile.
  function onUseConsumable(entry: InventoryEntry) {
    props.onUse(entry.itemId);
    setView((v) => ({ ...v, inventory: v.inventory.filter((i) => i.itemId !== entry.itemId) }));
    setTapMsg({ text: `Used ${getConsumable(entry.baseId)?.name ?? entry.baseId}.`, color: '#5ad17a' });
  }

  const attr = () => view().attributes;

  return (
    <div
      class="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col"
      style={{ 'font-family': 'var(--font-display, monospace)' }}
    >
      <div class="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div>
          <h2 class="ts-zone-name">Inventory &amp; Equipment</h2>
          <p class="ts-zone-sub">Click to equip/unequip · right-click to Tap (Refinement)</p>
        </div>
        <div class="flex items-center gap-4">
          <div class="ts-zone-sub" style={{ color: '#c9a98c' }}>
            Materials <span style={{ color: '#ff9f1a', 'font-size': '13px' }}>{view().materials}</span>
          </div>
          <button type="button" onClick={props.onClose} class="ts-btn">
            Close
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-5">
        <div class="flex gap-6 max-w-5xl mx-auto">
          {/* Equipment */}
          <div class="flex-1">
            <div class="ts-zone-sub mb-2" style={{ color: '#c9a98c' }}>
              Equipped
            </div>
            <div class="grid grid-cols-2 gap-2">
              <For each={EQUIP_SLOTS}>
                {(slot) => {
                  const eq = () => equippedBySlot().get(slot);
                  return (
                    <button
                      type="button"
                      disabled={!eq() || busy()}
                      onClick={() => eq() && onUnequip(slot)}
                      class="text-left px-3 py-2 min-h-[3.75rem] transition-all"
                      classList={{ 'cursor-pointer hover:brightness-110': !!eq(), 'cursor-default': !eq() }}
                      style={{
                        background: eq() ? 'var(--slot-fill, #13100d)' : 'rgba(255,255,255,0.02)',
                        'box-shadow': eq()
                          ? `0 0 0 2px #080706, 0 0 0 4px ${RARITY_COLOR[eq()!.rarity]}, 0 0 0 6px #080706`
                          : '0 0 0 2px #080706, 0 0 0 4px #2b2420, 0 0 0 6px #080706',
                      }}
                    >
                      <div class="text-[10px] uppercase tracking-wider text-white/40">
                        {SLOT_LABEL[slot]}
                      </div>
                      <Show when={eq()} fallback={<div class="text-xs text-white/25">empty</div>}>
                        <ItemTooltip baseId={eq()!.baseId} rarity={eq()!.rarity} affixes={eq()!.affixes} refinement={eq()!.refinement} />
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>

          {/* Carried + character sheet */}
          <div class="flex-1">
            <div class="ts-zone-sub mb-2" style={{ color: '#c9a98c' }}>
              Carried ({view().inventory.length})
            </div>
            <div class="grid grid-cols-2 gap-2">
              <Show
                when={view().inventory.length > 0}
                fallback={<div class="text-sm text-white/30 col-span-2 py-4">Bag is empty — go kill something.</div>}
              >
                <For each={view().inventory}>
                  {(it) => (
                    <button
                      type="button"
                      disabled={busy()}
                      onClick={() =>
                        isConsumable(it.baseId) ? onUseConsumable(it) : onEquip(it.itemId, it.baseId)
                      }
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (isConsumable(it.baseId)) return; // consumables aren't refinable
                        setTapMsg(null);
                        setTapTarget(it);
                      }}
                      class="text-left px-3 py-2 hover:brightness-110 cursor-pointer transition-all"
                      style={{
                        background: 'var(--slot-fill, #13100d)',
                        'box-shadow': `0 0 0 2px #080706, 0 0 0 4px ${isConsumable(it.baseId) ? '#5ad17a' : RARITY_COLOR[it.rarity]}, 0 0 0 6px #080706`,
                      }}
                    >
                      <ItemTooltip baseId={it.baseId} rarity={it.rarity} affixes={it.affixes} refinement={it.refinement} />
                    </button>
                  )}
                </For>
              </Show>
            </div>

            <div
              class="mt-6 p-4"
              style={{ background: '#140e0a', 'box-shadow': '0 0 0 2px #080706, 0 0 0 4px #2b2420, 0 0 0 6px #080706' }}
            >
              <div class="ts-zone-sub mb-3" style={{ color: '#c9a98c' }}>
                Character Sheet
              </div>
              <div class="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
                <Stat label="Strength" value={attr().str} color="#ff8a6a" />
                <Stat label="Dexterity" value={attr().dex} color="#8aff9a" />
                <Stat label="Intelligence" value={attr().int} color="#6ab0ff" />
                <Stat label="Vitality" value={attr().vit} color="#ffd24a" />
                <Stat label="Armor" value={view().armor} color="#cbd5e1" />
                <Stat label="Magic Find" value={view().magicFind} color="#ff9f1a" />
              </div>
              <p class="text-[10px] text-white/30 mt-3">
                INT + Fire% affixes raise Fire damage · weapon damage feeds your attacks ·
                Magic Find improves drop rarity (character stat, never gear).
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tap confirmation modal */}
      <Show when={tapTarget()}>
        <div class="absolute inset-0 flex items-center justify-center bg-black/60">
          <div
            class="w-80 p-5"
            style={{
              background: '#140e0a',
              'box-shadow': '0 0 0 2px #080706, 0 0 0 4px #2b2420, 0 0 0 6px #080706',
            }}
          >
            <h3 class="ts-zone-name" style={{ 'font-size': '16px' }}>Tap for Refinement</h3>
            <div class="mb-3 mt-1" style={{ color: RARITY_COLOR[tapTarget()!.rarity], 'font-size': '14px' }}>
              {getItemBase(tapTarget()!.baseId)?.name ?? tapTarget()!.baseId}
              <Show when={tapTarget()!.refinement > 0}>
                <span style={{ color: '#ff9f1a' }}> +{tapTarget()!.refinement}</span>
              </Show>
            </div>
            <p class="ts-zone-sub mb-1" style={{ color: '#c9a98c', 'letter-spacing': '0', 'text-transform': 'none' }}>
              Cost <span style={{ color: '#ff9f1a' }}>{TAP_COST}</span> materials
              (have {view().materials}).
            </p>
            <p class="ts-zone-sub mb-4" style={{ color: '#8a7f6e', 'letter-spacing': '0', 'text-transform': 'none', 'line-height': '1.5' }}>
              Success raises Refinement (+5% stats/level). Failure burns materials — the item is
              never destroyed. A pity counter guarantees eventual success.
            </p>
            <div class="flex gap-3 justify-end items-center">
              <button type="button" onClick={() => setTapTarget(null)} class="ts-btn">
                Cancel
              </button>
              <button
                type="button"
                disabled={tapping() || view().materials < TAP_COST}
                onClick={() => onTap(tapTarget()!)}
                class="ts-forge"
                classList={{ 'is-disabled': tapping() || view().materials < TAP_COST }}
              >
                {tapping() ? 'Tapping…' : 'Tap'}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Outcome popup */}
      <Show when={tapMsg()}>
        <div class="absolute top-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-black/85 border border-white/15 text-sm font-semibold animate-pulse"
          style={{ color: tapMsg()!.color }}
          onClick={() => setTapMsg(null)}
        >
          {tapMsg()!.text}
        </div>
      </Show>
    </div>
  );
}

function Stat(props: { label: string; value: number; color: string }) {
  return (
    <div class="flex items-center justify-between">
      <span class="text-white/60">{props.label}</span>
      <span class="font-mono font-bold" style={{ color: props.color }}>
        {props.value}
      </span>
    </div>
  );
}
