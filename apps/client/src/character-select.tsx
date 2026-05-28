import {
  createSignal,
  createResource,
  Show,
  For,
  Suspense,
} from 'solid-js';
import {
  listCharacters,
  createCharacter,
  playCharacter,
  type Character,
} from './character-client.js';

const ERROR_COPY: Record<string, string> = {
  'name-too-short': 'Name must be at least 2 characters.',
  'name-too-long': 'Name must be at most 20 characters.',
  'name-invalid-chars': 'Use letters, numbers, spaces, hyphens, or apostrophes.',
  'name-taken': 'You already have a character with that name.',
  'missing-fields': 'Please enter a name.',
};

export interface CharacterSelectProps {
  token: string;
  accountId: string | undefined;
  onPlay: (character: Character) => void;
  onLogout: () => void;
}

export function CharacterSelect(props: CharacterSelectProps) {
  const [characters, { refetch }] = createResource(
    () => props.token,
    (token) => listCharacters(token)
  );
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [createError, setCreateError] = createSignal<string | null>(null);

  async function handleCreate(e: Event) {
    e.preventDefault();
    setCreateError(null);
    setSubmitting(true);
    try {
      const result = await createCharacter(props.token, newName());
      if (result.ok) {
        setNewName('');
        setCreating(false);
        await refetch();
      } else {
        setCreateError(ERROR_COPY[result.error] ?? result.error);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePlay(c: Character) {
    const updated = await playCharacter(props.token, c.id);
    if (updated) props.onPlay(updated);
  }

  return (
    <div class="flex items-center justify-center h-full">
      <div class="w-[480px] bg-[color:var(--color-panel)] p-8 rounded-lg border border-white/10">
        <div class="flex items-center justify-between mb-6">
          <h1 class="text-2xl font-semibold">Choose your Awakened</h1>
          <button
            type="button"
            class="text-xs text-white/40 hover:text-white"
            onClick={props.onLogout}
          >
            Sign out
          </button>
        </div>

        <Suspense fallback={<p class="text-sm text-white/60">Loading…</p>}>
          <Show
            when={characters() && characters()!.length > 0}
            fallback={
              <p class="text-sm text-white/60 mb-6">
                You have no characters yet. Create your first below.
              </p>
            }
          >
            <ul class="flex flex-col gap-2 mb-6">
              <For each={characters()}>
                {(c) => (
                  <li class="flex items-center justify-between p-3 rounded bg-black/30 border border-white/10">
                    <div>
                      <div class="font-medium">{c.name}</div>
                      <div class="text-xs text-white/40">
                        {c.lastLoginAt
                          ? `Last played ${new Date(c.lastLoginAt).toLocaleString()}`
                          : 'Never played'}
                      </div>
                    </div>
                    <button
                      type="button"
                      class="py-1.5 px-3 rounded bg-[color:var(--color-brand)] text-black text-sm font-semibold hover:opacity-90"
                      onClick={() => handlePlay(c)}
                    >
                      Play
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Suspense>

        <Show
          when={creating()}
          fallback={
            <button
              type="button"
              class="w-full py-2 rounded bg-white/10 hover:bg-white/20 text-white text-sm"
              onClick={() => setCreating(true)}
            >
              Create new character
            </button>
          }
        >
          <form onSubmit={handleCreate} class="flex flex-col gap-3">
            <label class="text-xs uppercase tracking-wide text-white/60">
              Character name
              <input
                type="text"
                required
                autofocus
                value={newName()}
                onInput={(e) => setNewName(e.currentTarget.value)}
                class="mt-1 w-full px-3 py-2 rounded bg-black/40 border border-white/10 text-white outline-none focus:border-[color:var(--color-brand)]"
                maxlength={20}
              />
            </label>
            <Show when={createError()}>
              <div class="text-sm text-red-400">{createError()}</div>
            </Show>
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 py-2 rounded bg-white/10 hover:bg-white/20 text-white text-sm"
                onClick={() => {
                  setCreating(false);
                  setNewName('');
                  setCreateError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting()}
                class="flex-1 py-2 rounded bg-[color:var(--color-brand)] hover:opacity-90 text-black text-sm font-semibold disabled:opacity-50"
              >
                {submitting() ? '…' : 'Create'}
              </button>
            </div>
          </form>
        </Show>

        <Show when={props.accountId}>
          <div class="mt-6 text-[10px] font-mono text-white/30 text-center break-all">
            account {props.accountId}
          </div>
        </Show>
      </div>
    </div>
  );
}
