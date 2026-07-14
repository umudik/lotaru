import { Github } from 'lucide-react';
import { clearSession, getUser, signInUrl } from '@/lib/config';
import { cn } from '@/lib/utils';

const GITHUB_URL = 'https://github.com/umudik/lotaru';

interface Props {
  className?: string;
}

export function SiteHeader(props: Props): React.JSX.Element {
  const user = getUser();

  return (
    <header
      className={cn(
        'relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto',
        props.className,
      )}
    >
      <a href="/" className="flex items-center gap-2.5 group">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground shadow-lg shadow-primary/25 group-hover:scale-105 transition-transform">
          L
        </span>
        <span className="text-lg font-semibold tracking-tight">Lotaru</span>
      </a>
      <nav className="flex items-center gap-6 text-sm">
        <a
          href="#features"
          className="text-muted-foreground hover:text-foreground transition-colors hidden sm:inline"
        >
          Features
        </a>
        <a
          href="#how"
          className="text-muted-foreground hover:text-foreground transition-colors hidden sm:inline"
        >
          How it works
        </a>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Github className="h-4 w-4" />
          <span className="hidden sm:inline">GitHub</span>
        </a>
        {user !== null ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              clearSession();
              location.reload();
            }}
          >
            Sign out
          </button>
        ) : (
          <button
            type="button"
            className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
            onClick={() => {
              void signInUrl().then((url) => {
                location.href = url;
              });
            }}
          >
            Sign in
          </button>
        )}
      </nav>
    </header>
  );
}
