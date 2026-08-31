import { watch as watchFiles, type FSWatcher } from "chokidar";
import { clearTimeout, setTimeout } from "node:timers";

export type WatchedFileKind = "add" | "change" | "unlink";

export type WatchedFileEvent = {
  projectId: string;
  path: string;
  kind: WatchedFileKind;
};

export type FileWatchers = {
  watch(projectId: string, rootPath: string): void;
  unwatch(projectId: string): void;
  sync(targets: readonly { projectId: string; rootPath: string }[]): void;
  closeAll(): Promise<void>;
};

const IGNORED_SEGMENTS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".script",
  ".aws",
  ".cache",
  ".local",
  ".cursor",
];

function isSqliteSidecarName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith(".sqlite")) {
    return true;
  }
  if (lower.endsWith(".sqlite-wal")) {
    return true;
  }
  if (lower.endsWith(".sqlite-shm")) {
    return true;
  }
  if (lower.endsWith(".db-wal")) {
    return true;
  }
  if (lower.endsWith(".db-shm")) {
    return true;
  }
  if (lower.endsWith("-journal")) {
    return true;
  }
  return false;
}

function isIgnoredRuntimeFileName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === ".ds_store") {
    return true;
  }
  if (lower === "thumbs.db") {
    return true;
  }
  if (isSqliteSidecarName(lower)) {
    return true;
  }
  return false;
}

export function shouldIgnoreWatchPath(filePath: string): boolean {
  const normalised = filePath.replaceAll("\\", "/");
  const parts = normalised.split("/");
  for (const segment of parts) {
    for (const ignored of IGNORED_SEGMENTS) {
      if (segment === ignored) {
        return true;
      }
    }
    if (isIgnoredRuntimeFileName(segment)) {
      return true;
    }
  }
  return false;
}

export function createFileWatchers(onEvent: (event: WatchedFileEvent) => void): FileWatchers {
  const watchers = new Map<string, FSWatcher>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  function emit(projectId: string, filePath: string, kind: WatchedFileKind): void {
    const key = `${projectId}::${filePath}`;
    const existing = pending.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      pending.delete(key);
      onEvent({ projectId, path: filePath, kind });
    }, 150);
    pending.set(key, timer);
  }

  function watchProject(projectId: string, rootPath: string): void {
    const existing = watchers.get(projectId);
    if (existing !== undefined) {
      void existing.close();
    }
    const watcher = watchFiles(rootPath, {
      ignored: shouldIgnoreWatchPath,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      persistent: true,
    });
    watcher.on("add", (filePath: string) => {
      emit(projectId, filePath, "add");
    });
    watcher.on("change", (filePath: string) => {
      emit(projectId, filePath, "change");
    });
    watcher.on("unlink", (filePath: string) => {
      emit(projectId, filePath, "unlink");
    });
    watchers.set(projectId, watcher);
  }

  function unwatchProject(projectId: string): void {
    const watcher = watchers.get(projectId);
    if (watcher === undefined) {
      return;
    }
    void watcher.close();
    watchers.delete(projectId);
  }

  return {
    watch: watchProject,
    unwatch: unwatchProject,
    sync(targets: readonly { projectId: string; rootPath: string }[]): void {
      const wanted = new Set<string>();
      for (const target of targets) {
        wanted.add(target.projectId);
        watchProject(target.projectId, target.rootPath);
      }
      const openIds: string[] = [];
      for (const projectId of watchers.keys()) {
        openIds.push(projectId);
      }
      for (const projectId of openIds) {
        if (!wanted.has(projectId)) {
          unwatchProject(projectId);
        }
      }
    },
    async closeAll(): Promise<void> {
      const closing: Promise<void>[] = [];
      for (const watcher of watchers.values()) {
        closing.push(watcher.close());
      }
      watchers.clear();
      await Promise.all(closing);
    },
  };
}
