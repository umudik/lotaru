import { Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GITHUB_URL, signInUrl } from '@/lib/config';

export function ConsoleTopbar(): React.JSX.Element {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-3">
      <a href="/" className="flex items-center gap-2.5 shrink-0">
        <span className="flex h-7 w-7 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground">
          L
        </span>
        <span className="text-sm font-semibold tracking-tight">Lotaru</span>
        <span className="hidden text-sm text-muted-foreground sm:inline">Console</span>
      </a>

      <div className="mx-auto hidden w-full max-w-md md:block">
        <Input
          readOnly
          placeholder="Search projects, tasks, agents"
          className="h-8 bg-muted/40"
          aria-label="Search"
        />
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="sm" asChild>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <Github className="h-4 w-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </Button>
        <Button size="sm" asChild>
          <a href={signInUrl()}>Sign in</a>
        </Button>
      </div>
    </header>
  );
}
