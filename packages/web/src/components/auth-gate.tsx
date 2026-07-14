import { useEffect, useState } from 'react';
import { FookieCloudBack } from '@/components/fookie-cloud-back';
import {
  clearSession,
  exchangeCode,
  getAccessToken,
  isCloudHost,
  signInUrl,
  tokenStillValid,
} from '@/lib/auth';

interface Props {
  children: React.ReactNode;
}

export function AuthGate(props: Props): React.JSX.Element {
  const [boot, setBoot] = useState<'skip' | 'loading' | 'ready' | 'auth' | 'error'>(() =>
    isCloudHost() ? 'loading' : 'skip',
  );
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCloudHost()) {
      return;
    }

    const url = new URL(location.href);
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (code === null || state === null) {
        setBoot('error');
        setAuthError('Missing OAuth code');
        return;
      }
      setBoot('auth');
      void exchangeCode(code, state)
        .then(() => {
          history.replaceState({}, '', '/');
          setBoot('ready');
        })
        .catch((err: unknown) => {
          clearSession();
          setBoot('error');
          setAuthError(err instanceof Error ? err.message : 'Auth failed');
        });
      return;
    }

    const token = getAccessToken();
    if (token === null) {
      void signInUrl().then((href) => {
        location.href = href;
      });
      return;
    }

    void tokenStillValid(token).then((ok) => {
      if (ok) {
        setBoot('ready');
        return;
      }
      clearSession();
      void signInUrl().then((href) => {
        location.href = href;
      });
    });
  }, []);

  if (boot === 'skip' || boot === 'ready') {
    return <>{props.children}</>;
  }

  if (boot === 'error') {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-sm gap-3">
        <p className="text-destructive">{authError ?? 'Auth failed'}</p>
        <button
          type="button"
          className="text-primary underline"
          onClick={() => {
            history.replaceState({}, '', '/');
            clearSession();
            void signInUrl().then((href) => {
              location.href = href;
            });
          }}
        >
          Try again
        </button>
        <FookieCloudBack />
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background text-sm text-muted-foreground">
      {boot === 'auth' ? 'Signing in…' : 'Redirecting to Fookie Auth…'}
    </div>
  );
}
