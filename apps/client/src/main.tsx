// Client bootstrap. After auth, hands off to character select.
// Gameplay handshake (S03 #5) becomes the next destination after "Play".

import { render } from 'solid-js/web';
import { createSignal, Show, onMount, createEffect } from 'solid-js';
import './styles.css';
import { LoginScreen } from './login-screen.js';
import {
  loadSession,
  consumeOAuthRedirect,
  clearSession,
  storeSession,
} from './auth-client.js';
import { fetchMe } from './character-client.js';
import { CharacterSelect } from './character-select.js';
import type { Character } from './character-client.js';

interface Session {
  sessionToken: string;
  accountId: string | undefined;
}

function App() {
  const [session, setSession] = createSignal<Session | null>(loadSession());
  const [activeCharacter, setActiveCharacter] = createSignal<Character | null>(null);

  onMount(() => {
    const redirect = consumeOAuthRedirect();
    if (redirect?.kind === 'success') {
      setSession({ sessionToken: redirect.sessionToken, accountId: undefined });
    }
  });

  // After auth, fill in accountId from /me if we don't have it yet (covers the
  // Discord callback case where the redirect doesn't carry accountId).
  createEffect(() => {
    const s = session();
    if (s && !s.accountId) {
      void (async () => {
        const me = await fetchMe(s.sessionToken);
        if (me) {
          storeSession(s.sessionToken, me.accountId);
          setSession({ sessionToken: s.sessionToken, accountId: me.accountId });
        }
      })();
    }
  });

  function logout(): void {
    clearSession();
    setSession(null);
    setActiveCharacter(null);
  }

  return (
    <Show
      when={session()}
      fallback={
        <LoginScreen
          onAuth={(r) =>
            setSession({ sessionToken: r.sessionToken, accountId: r.accountId })
          }
        />
      }
    >
      <Show
        when={!activeCharacter()}
        fallback={
          <GameplayStub
            character={activeCharacter()!}
            onLeave={() => setActiveCharacter(null)}
            onLogout={logout}
          />
        }
      >
        <CharacterSelect
          token={session()!.sessionToken}
          accountId={session()!.accountId}
          onPlay={setActiveCharacter}
          onLogout={logout}
        />
      </Show>
    </Show>
  );
}

function GameplayStub(props: {
  character: Character;
  onLeave: () => void;
  onLogout: () => void;
}) {
  return (
    <div class="flex items-center justify-center h-full">
      <div class="w-[420px] bg-[color:var(--color-panel)] p-8 rounded-lg border border-white/10">
        <h1 class="text-2xl font-semibold mb-1">In the world</h1>
        <p class="text-sm text-white/50 mb-4">
          Playing as <span class="text-white font-medium">{props.character.name}</span>
        </p>
        <p class="text-sm text-white/50 mb-4">
          The real gameplay handshake (gateway → channel → zone) lands in{' '}
          <a
            href="https://github.com/jknack0/mmo/issues/5"
            target="_blank"
            class="text-[color:var(--color-brand)] underline"
          >
            issue #5 (S03)
          </a>
          .
        </p>
        <div class="flex gap-2">
          <button
            type="button"
            class="flex-1 py-2 rounded bg-white/10 hover:bg-white/20 text-white text-sm"
            onClick={props.onLeave}
          >
            Back to character select
          </button>
          <button
            type="button"
            class="flex-1 py-2 rounded bg-white/10 hover:bg-white/20 text-white text-sm"
            onClick={props.onLogout}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');
render(() => <App />, root);
