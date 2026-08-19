import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export function requireExistingDirectory(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Folder path is required");
  }
  if (!isAbsolute(trimmed)) {
    throw new Error("Folder path must be absolute");
  }
  const absolute = resolve(trimmed);
  if (!existsSync(absolute)) {
    throw new Error("Folder path does not exist");
  }
  const info = statSync(absolute);
  if (!info.isDirectory()) {
    throw new Error("Folder path is not a directory");
  }
  return absolute;
}
