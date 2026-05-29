// Pyromancy passive-tree panel (S10 #12). Full-screen overlay: 2 root nodes
// up top, then three archetype columns (Direct / Burn / Utility), each gated
// tier-by-tier. Allocation rules come from @mmo/domain so the preview here
// matches exactly what the gateway will accept on Save.

import { createSignal, onMount, For, Show } from 'solid-js';
import {
  PASSIVE_NODES,
  PASSIVE_POOL_SIZE,
  allocatableNodes,
  validateAllocation,
  totalPointsSpent,
  fetchPassives,
  savePassives,
  type PassiveNode,
  type PassivePath,
  type PassiveAllocation,
} from './passives.js';

export interface PassiveTreePanelProps {
  token: string;
  characterId: string;
  onClose: () => void;
}

const PATH_META: Record<PassivePath, { title: string; color: string }> = {
  root: { title: 'Core', color: '#cbd5e1' },
  direct: { title: 'Direct Burst', color: '#ffd24a' },
  burn: { title: 'Burn Stacker', color: '#ff6a3a' },
  utility: { title: 'Utility / Control', color: '#6ab0ff' },
};

const isKeystone = (n: PassiveNode): boolean =>
  n.effects.some((e) => 'kind' in e && e.kind === 'keystone');

function byPath(path: PassivePath): PassiveNode[] {
  return PASSIVE_NODES.filter((n) => n.path === path).sort((a, b) => a.tier - b.tier);
}

export function PassiveTreePanel(props: PassiveTreePanelProps) {
  const [alloc, setAlloc] = createSignal<PassiveAllocation>({});
  const [saved, setSaved] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  onMount(async () => {
    const loaded = await fetchPassives(props.token, props.characterId);
    setAlloc(loaded);
  });

  const spent = () => totalPointsSpent(alloc());
  const remaining = () => PASSIVE_POOL_SIZE - spent();
  const allocatable = () => new Set(allocatableNodes(alloc()));

  const isAllocated = (id: string) => (alloc()[id] ?? 0) >= 1;
  const canAllocate = (id: string) => allocatable().has(id);
  const isRefundable = (id: string) => {
    if (!isAllocated(id)) return false;
    const next = { ...alloc() };
    delete next[id];
    return validateAllocation(next).ok; // refuse if it would orphan a dependent
  };

  function toggle(node: PassiveNode) {
    setSaved(false);
    const id = node.id;
    if (isAllocated(id)) {
      if (!isRefundable(id)) return;
      const next = { ...alloc() };
      delete next[id];
      setAlloc(next);
    } else {
      if (!canAllocate(id)) return;
      setAlloc({ ...alloc(), [id]: 1 });
    }
  }

  async function onSave() {
    setSaving(true);
    const ok = await savePassives(props.token, props.characterId, alloc());
    setSaving(false);
    setSaved(ok);
  }

  function reset() {
    setSaved(false);
    setAlloc({});
  }

  function NodeCard(p: { node: PassiveNode }) {
    const node = p.node;
    const meta = PATH_META[node.path];
    const allocated = () => isAllocated(node.id);
    const locked = () => !allocated() && !canAllocate(node.id);
    const refundableNow = () => allocated() && isRefundable(node.id);
    const key = () => isKeystone(node);
    return (
      <button
        type="button"
        disabled={locked()}
        onClick={() => toggle(node)}
        title={
          locked()
            ? 'Locked — allocate the prerequisite node first'
            : allocated() && !refundableNow()
            ? 'Remove dependent nodes before refunding this one'
            : node.description
        }
        class="w-full text-left rounded-lg px-3 py-2 transition-all border-2"
        classList={{
          'cursor-not-allowed opacity-35': locked(),
          'cursor-pointer hover:brightness-110': !locked(),
        }}
        style={{
          'border-color': allocated() ? meta.color : 'rgba(255,255,255,0.12)',
          background: allocated()
            ? `linear-gradient(180deg, ${meta.color}33, ${meta.color}11)`
            : 'rgba(255,255,255,0.04)',
          'box-shadow': allocated() && key() ? `0 0 14px ${meta.color}88` : 'none',
        }}
      >
        <div class="flex items-center justify-between gap-2">
          <span
            class="text-sm font-semibold"
            style={{ color: allocated() ? '#fff' : 'rgba(255,255,255,0.85)' }}
          >
            {key() ? '★ ' : ''}
            {node.name}
          </span>
          <span class="text-[10px] uppercase tracking-wider text-white/40">
            {node.path === 'root' ? 'Core' : `T${node.tier}`}
          </span>
        </div>
        <div class="text-[11px] leading-snug text-white/55 mt-0.5">{node.description}</div>
      </button>
    );
  }

  function PathColumn(p: { path: PassivePath }) {
    const meta = PATH_META[p.path];
    return (
      <div class="flex flex-col gap-2 flex-1 min-w-0">
        <div
          class="text-xs font-bold uppercase tracking-widest pb-1 border-b"
          style={{ color: meta.color, 'border-color': `${meta.color}55` }}
        >
          {meta.title}
        </div>
        <For each={byPath(p.path)}>{(node) => <NodeCard node={node} />}</For>
      </div>
    );
  }

  return (
    <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div class="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div>
          <h2 class="text-lg font-bold text-white">Pyromancy — Passive Tree</h2>
          <p class="text-xs text-white/45">
            Shared pool across both disciplines · prerequisite gating per path
          </p>
        </div>
        <div class="flex items-center gap-4">
          <div class="text-sm text-white/80">
            Points{' '}
            <span
              class="font-mono font-bold"
              style={{ color: remaining() === 0 ? '#ff6a3a' : '#ffd24a' }}
            >
              {spent()}/{PASSIVE_POOL_SIZE}
            </span>
          </div>
          <button
            type="button"
            onClick={reset}
            class="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-sm"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving()}
            class="px-4 py-1.5 rounded bg-orange-500/80 hover:bg-orange-500 text-white text-sm font-semibold disabled:opacity-50"
          >
            <Show when={!saving()} fallback="Saving…">
              <Show when={saved()} fallback="Save">
                Saved ✓
              </Show>
            </Show>
          </button>
          <button
            type="button"
            onClick={props.onClose}
            class="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white text-sm"
          >
            Close
          </button>
        </div>
      </div>

      {/* Body */}
      <div class="flex-1 overflow-y-auto px-6 py-5">
        {/* Root nodes */}
        <div class="max-w-xl mx-auto mb-6">
          <div class="grid grid-cols-2 gap-3">
            <For each={byPath('root')}>{(node) => <NodeCard node={node} />}</For>
          </div>
        </div>

        {/* Three archetype paths */}
        <div class="flex gap-4 max-w-5xl mx-auto">
          <PathColumn path="direct" />
          <PathColumn path="burn" />
          <PathColumn path="utility" />
        </div>
      </div>
    </div>
  );
}
