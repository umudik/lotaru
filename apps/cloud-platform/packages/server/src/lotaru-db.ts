import { join } from "node:path";

export function lotaruDatabasePath(dataDir: string): string {
  return join(dataDir, "app.sqlite");
}
