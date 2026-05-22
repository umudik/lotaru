import chokidar from 'chokidar';
import micromatch from 'micromatch';
import type { FSWatcher } from 'chokidar';

export interface WatchEvent {
  workspaceId: string;
  path: string;
  kind: 'add' | 'change' | 'unlink';
}

export interface WatcherManager {
  watch(workspaceId: string, rootPath: string): void;
  unwatch(workspaceId: string): void;
  closeAll(): Promise<void>;
}

const DEFAULT_IGNORES: string[] = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.lotaru/**',
];

export function createWatcherManager(onEvent: (e: WatchEvent) => void): WatcherManager {
  const watchers = new Map<string, FSWatcher>();
  const pending = new Map<string, NodeJS.Timeout>();

  function emit(workspaceId: string, path: string, kind: WatchEvent['kind']): void {
    const key = `${workspaceId}::${path}`;
    const existing = pending.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const t = setTimeout(() => {
      pending.delete(key);
      onEvent({ workspaceId, path, kind });
    }, 150);
    pending.set(key, t);
  }

  return {
    watch(workspaceId: string, rootPath: string): void {
      const existing = watchers.get(workspaceId);
      if (existing !== undefined) {
        void existing.close();
      }
      const w = chokidar.watch(rootPath, {
        ignored: DEFAULT_IGNORES,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
        persistent: true,
      });
      w.on('add', (p) => {
        emit(workspaceId, p, 'add');
      });
      w.on('change', (p) => {
        emit(workspaceId, p, 'change');
      });
      w.on('unlink', (p) => {
        emit(workspaceId, p, 'unlink');
      });
      w.on('error', (err) => {
        console.error('watcher error', workspaceId, err);
      });
      watchers.set(workspaceId, w);
    },
    unwatch(workspaceId: string): void {
      const w = watchers.get(workspaceId);
      if (w === undefined) {
        return;
      }
      void w.close();
      watchers.delete(workspaceId);
    },
    async closeAll(): Promise<void> {
      const all: Promise<void>[] = [];
      for (const w of watchers.values()) {
        all.push(w.close());
      }
      watchers.clear();
      await Promise.all(all);
    },
  };
}

export function matchesGlob(path: string, root: string, glob: string | null): boolean {
  if (glob === null || glob === '') {
    return true;
  }
  let rel = path;
  if (path.startsWith(root)) {
    rel = path.slice(root.length).replace(/^[\\/]/, '');
  }
  const normalised = rel.replace(/\\/g, '/');
  return micromatch.isMatch(normalised, glob);
}
