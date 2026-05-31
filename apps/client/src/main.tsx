// Client bootstrap. Three app states: login → character select → in-world.

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
import { fetchMe, type Character } from './character-client.js';
import { CharacterSelect } from './character-select.js';
import { WorldScreen } from './world-screen.js';
import { e2eSet } from './e2e-hook.js';

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

  // E2E hook (S26): publish the current app phase for the Playwright driver.
  createEffect(() => {
    e2eSet({ phase: !session() ? 'login' : !activeCharacter() ? 'character' : 'world' });
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
          <WorldScreen
            sessionToken={session()!.sessionToken}
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

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');
render(() => <App />, root);
