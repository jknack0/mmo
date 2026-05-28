// Client bootstrap. S01 (#3): renders the login screen.
// Character-select (S02 #4) is a placeholder for now.

import { render } from 'solid-js/web';
import { createSignal, Show, onMount } from 'solid-js';
import './styles.css';
import { LoginScreen } from './login-screen.js';
import { loadSession, consumeOAuthRedirect, clearSession } from './auth-client.js';

function App() {
  const [session, setSession] = createSignal<
    { sessionToken: string; accountId?: string } | null
  >(loadSession());

  onMount(() => {
    const redirect = consumeOAuthRedirect();
    if (redirect?.kind === 'success') {
      setSession({ sessionToken: redirect.sessionToken });
    }
  });

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
      <CharacterSelectStub
        token={session()!.sessionToken}
        accountId={session()?.accountId}
        onLogout={() => {
          clearSession();
          setSession(null);
        }}
      />
    </Show>
  );
}

function CharacterSelectStub(props: {
  token: string;
  accountId: string | undefined;
  onLogout: () => void;
}) {
  return (
    <div class="flex items-center justify-center h-full">
      <div class="w-[420px] bg-[color:var(--color-panel)] p-8 rounded-lg border border-white/10">
        <h1 class="text-2xl font-semibold mb-2">Signed in</h1>
        <p class="text-sm text-white/50 mb-4">
          Character select lands in{' '}
          <a
            href="https://github.com/jknack0/mmo/issues/4"
            target="_blank"
            class="text-[color:var(--color-brand)] underline"
          >
            issue #4 (S02)
          </a>
          .
        </p>
        <div class="text-xs font-mono break-all text-white/40 mb-4">
          <div>token: {props.token.slice(0, 16)}…</div>
          {props.accountId ? <div>account: {props.accountId}</div> : null}
        </div>
        <button
          type="button"
          class="py-2 px-4 rounded bg-white/10 hover:bg-white/20 text-white text-sm"
          onClick={props.onLogout}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');
render(() => <App />, root);
