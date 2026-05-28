import { createSignal, Show } from 'solid-js';
import {
  registerEmail,
  loginEmail,
  startDiscordOAuth,
  type AuthResult,
} from './auth-client.js';

type Mode = 'login' | 'register';

const ERROR_COPY: Record<string, string> = {
  'invalid-credentials': 'Wrong email or password.',
  'email-already-exists': 'An account with that email already exists.',
  'weak-password': 'Password must be at least 8 characters.',
  'discord-state-invalid': 'Discord login expired — try again.',
  'discord-exchange-failed': 'Discord authentication failed.',
  'missing-fields': 'Please fill in both fields.',
  unknown: 'Something went wrong. Please try again.',
};

export function LoginScreen(props: { onAuth: (r: AuthResult & { ok: true }) => void }) {
  const [mode, setMode] = createSignal<Mode>('login');
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const fn = mode() === 'login' ? loginEmail : registerEmail;
      const result = await fn(email(), password());
      if (result.ok) {
        props.onAuth(result);
      } else {
        setError(ERROR_COPY[result.error] ?? ERROR_COPY.unknown);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="flex items-center justify-center h-full">
      <div class="w-[360px] bg-[color:var(--color-panel)] p-8 rounded-lg border border-white/10">
        <h1 class="text-2xl font-semibold mb-1">MMO — Alpha</h1>
        <p class="text-sm text-white/50 mb-6">
          {mode() === 'login' ? 'Sign in to continue' : 'Create an account'}
        </p>

        <button
          type="button"
          class="w-full mb-3 py-2 rounded bg-[#5865F2] hover:bg-[#4a55d6] text-white font-medium"
          onClick={() => startDiscordOAuth()}
        >
          Continue with Discord
        </button>

        <div class="flex items-center gap-2 my-4">
          <hr class="flex-1 border-white/10" />
          <span class="text-xs text-white/40">or</span>
          <hr class="flex-1 border-white/10" />
        </div>

        <form onSubmit={handleSubmit} class="flex flex-col gap-3">
          <label class="text-xs uppercase tracking-wide text-white/60">
            Email
            <input
              type="email"
              required
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              class="mt-1 w-full px-3 py-2 rounded bg-black/40 border border-white/10 text-white outline-none focus:border-[color:var(--color-brand)]"
              autocomplete="email"
            />
          </label>
          <label class="text-xs uppercase tracking-wide text-white/60">
            Password
            <input
              type="password"
              required
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              class="mt-1 w-full px-3 py-2 rounded bg-black/40 border border-white/10 text-white outline-none focus:border-[color:var(--color-brand)]"
              autocomplete={mode() === 'login' ? 'current-password' : 'new-password'}
              minlength={8}
            />
          </label>

          <Show when={error()}>
            <div class="text-sm text-red-400">{error()}</div>
          </Show>

          <button
            type="submit"
            disabled={submitting()}
            class="mt-2 py-2 rounded bg-[color:var(--color-brand)] hover:opacity-90 text-black font-semibold disabled:opacity-50"
          >
            {submitting()
              ? '…'
              : mode() === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          class="mt-4 text-xs text-white/60 hover:text-white w-full text-center"
          onClick={() => {
            setMode(mode() === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          {mode() === 'login'
            ? "Don't have an account? Create one"
            : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
