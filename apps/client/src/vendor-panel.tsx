// Vendor panel (S16 #18). Two tabs: Buy (the static catalog — potions + a
// tapping-materials bundle) and Sell (drag your carried items to the vendor for
// gold). Every trade hits the gateway, which moves gold + writes an immutable
// audit row, then returns the refreshed bag so this view re-renders.

import { createSignal, onMount, For, Show, createEffect } from 'solid-js';
import {
  fetchInventory,
  fetchVendorCatalog,
  buyItem,
  sellItem,
  itemDisplayName,
  sellValue,
  RARITY_COLOR,
  type InventoryView,
  type InventoryEntry,
  type VendorEntry,
  type VendorView,
} from './inventory.js';

export interface VendorPanelProps {
  token: string;
  characterId: string;
  refreshKey: number;
  /** Bumped after any trade so the inventory panel refetches. */
  onChanged: () => void;
  onClose: () => void;
}

export function VendorPanel(props: VendorPanelProps) {
  const [view, setView] = createSignal<InventoryView | null>(null);
  const [catalog, setCatalog] = createSignal<VendorEntry[]>([]);
  const [tab, setTab] = createSignal<'buy' | 'sell'>('buy');
  const [busy, setBusy] = createSignal(false);
  const [msg, setMsg] = createSignal<{ text: string; color: string } | null>(null);

  async function refresh() {
    setView(await fetchInventory(props.token, props.characterId));
  }
  onMount(async () => {
    setCatalog(await fetchVendorCatalog());
    await refresh();
  });
  createEffect(() => {
    props.refreshKey;
    void refresh();
  });

  const gold = () => view()?.gold ?? 0;
  const materials = () => view()?.materials ?? 0;

  /** Fold a successful trade's returned fields back into the bag view. */
  function applyTrade(res: VendorView) {
    const cur = view();
    if (!cur) return;
    setView({ ...cur, inventory: res.inventory, gold: res.gold, materials: res.materials });
    props.onChanged();
  }

  async function onBuy(entry: VendorEntry) {
    if (busy()) return;
    setBusy(true);
    const res = await buyItem(props.token, props.characterId, entry.baseId);
    setBusy(false);
    if ('error' in res) {
      setMsg({ text: res.error === 'insufficient-gold' ? 'Not enough gold.' : res.error, color: '#ff6a6a' });
      return;
    }
    applyTrade(res);
    setMsg({ text: `Bought ${entry.name}.`, color: '#7CFC9A' });
  }

  async function onSell(it: InventoryEntry) {
    if (busy()) return;
    setBusy(true);
    const res = await sellItem(props.token, props.characterId, it.itemId);
    setBusy(false);
    if ('error' in res) {
      setMsg({ text: res.error, color: '#ff6a6a' });
      return;
    }
    applyTrade(res);
    setMsg({ text: `Sold for +${res.value} gold.`, color: '#ffd24a' });
  }

  return (
    <div
      class="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col"
      style={{ 'font-family': 'var(--font-display, monospace)' }}
    >
      <div class="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div>
          <h2 class="ts-zone-name">Veridian Quartermaster</h2>
          <p class="ts-zone-sub">Buy supplies · sell loot for gold</p>
        </div>
        <div class="flex items-center gap-4">
          <div class="ts-zone-sub" style={{ color: '#c9a98c' }}>
            Gold <span style={{ color: '#ffd24a', 'font-size': '13px' }}>{gold()}</span>
          </div>
          <div class="ts-zone-sub" style={{ color: '#c9a98c' }}>
            Materials <span style={{ color: '#ff9f1a', 'font-size': '13px' }}>{materials()}</span>
          </div>
          <button type="button" onClick={props.onClose} class="ts-btn">
            Close
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div class="flex gap-2 px-6 pt-4">
        <button
          type="button"
          class="ts-btn"
          classList={{ 'is-disabled': tab() !== 'buy' }}
          style={{ opacity: tab() === 'buy' ? 1 : 0.55 }}
          onClick={() => setTab('buy')}
        >
          Buy
        </button>
        <button
          type="button"
          class="ts-btn"
          style={{ opacity: tab() === 'sell' ? 1 : 0.55 }}
          onClick={() => setTab('sell')}
        >
          Sell
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-5">
        <div class="max-w-3xl mx-auto">
          {/* Buy */}
          <Show when={tab() === 'buy'}>
            <div class="grid grid-cols-1 gap-2">
              <For each={catalog()}>
                {(entry) => (
                  <div
                    class="flex items-center justify-between px-4 py-3"
                    style={{ background: '#140e0a', 'box-shadow': '0 0 0 2px #080706, 0 0 0 4px #2b2420, 0 0 0 6px #080706' }}
                  >
                    <div>
                      <div class="text-sm" style={{ color: '#e8e0d4' }}>{entry.name}</div>
                      <div class="text-[11px] text-white/40">
                        {entry.kind === 'materials' ? `+${entry.materialAmount} tapping materials` : 'consumable'}
                      </div>
                    </div>
                    <div class="flex items-center gap-3">
                      <span class="text-sm" style={{ color: '#ffd24a' }}>{entry.price}g</span>
                      <button
                        type="button"
                        class="ts-btn"
                        disabled={busy() || gold() < entry.price}
                        classList={{ 'is-disabled': busy() || gold() < entry.price }}
                        onClick={() => onBuy(entry)}
                      >
                        Buy
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Sell */}
          <Show when={tab() === 'sell'}>
            <Show
              when={(view()?.inventory.length ?? 0) > 0}
              fallback={<div class="text-sm text-white/30 py-6">Nothing to sell — bag is empty.</div>}
            >
              <div class="grid grid-cols-1 gap-2">
                <For each={view()!.inventory}>
                  {(it) => (
                    <div
                      class="flex items-center justify-between px-4 py-3"
                      style={{ background: '#140e0a', 'box-shadow': `0 0 0 2px #080706, 0 0 0 4px ${RARITY_COLOR[it.rarity]}, 0 0 0 6px #080706` }}
                    >
                      <div>
                        <div class="text-sm" style={{ color: RARITY_COLOR[it.rarity] }}>
                          {itemDisplayName(it.baseId)}
                          <Show when={it.refinement > 0}>
                            <span style={{ color: '#ff9f1a' }}> +{it.refinement}</span>
                          </Show>
                        </div>
                      </div>
                      <div class="flex items-center gap-3">
                        <span class="text-sm" style={{ color: '#ffd24a' }}>
                          +{sellValue(it.baseId, it.affixes.length)}g
                        </span>
                        <button
                          type="button"
                          class="ts-btn"
                          disabled={busy()}
                          onClick={() => onSell(it)}
                        >
                          Sell
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </div>

      <Show when={msg()}>
        <div
          class="absolute top-24 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-black/85 border border-white/15 text-sm font-semibold"
          style={{ color: msg()!.color }}
          onClick={() => setMsg(null)}
        >
          {msg()!.text}
        </div>
      </Show>
    </div>
  );
}
