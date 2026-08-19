import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import {
  parseAgentKind,
  parseAgentMode,
  type AgentKind,
  type AgentMode,
  type AgentProfile,
} from "./agent-runtime.js";

const PROFILE_ID = "lotaru";

const profileInputSchema = z.object({
  kind: z.enum(["ollama", "cursor", "claude", "codex"]),
  mode: z.enum(["ask", "plan", "execute"]),
  command: z.string().trim(),
});

export const DEFAULT_AGENT_PROFILE: AgentProfile = {
  kind: "ollama",
  mode: "ask",
  command: "",
};

type ProfileRow = {
  id: string;
  kind: string;
  mode: string;
  command: string;
};

export function parseAgentProfileInput(body: unknown): AgentProfile {
  const parsed = profileInputSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Invalid agent profile");
  }
  return {
    kind: parsed.data.kind,
    mode: parsed.data.mode,
    command: parsed.data.command,
  };
}

export function openAgentDb(databasePath: string): Database.Database {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runtime (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      mode TEXT NOT NULL,
      command TEXT NOT NULL
    );
  `);
  const existing = db.prepare("SELECT id FROM agent_runtime WHERE id = ?").get(PROFILE_ID) as
    | { id: string }
    | undefined;
  if (existing === undefined) {
    db.prepare("INSERT INTO agent_runtime (id, kind, mode, command) VALUES (?, ?, ?, ?)").run(
      PROFILE_ID,
      DEFAULT_AGENT_PROFILE.kind,
      DEFAULT_AGENT_PROFILE.mode,
      DEFAULT_AGENT_PROFILE.command,
    );
  }
  return db;
}

export function loadAgentProfile(db: Database.Database): AgentProfile {
  const row = db.prepare("SELECT * FROM agent_runtime WHERE id = ?").get(PROFILE_ID) as
    | ProfileRow
    | undefined;
  if (row === undefined) {
    return DEFAULT_AGENT_PROFILE;
  }
  const kind: AgentKind = parseAgentKind(row.kind);
  const mode: AgentMode = parseAgentMode(row.mode);
  return { kind, mode, command: row.command };
}

export function saveAgentProfile(db: Database.Database, profile: AgentProfile): AgentProfile {
  db.prepare("UPDATE agent_runtime SET kind = ?, mode = ?, command = ? WHERE id = ?").run(
    profile.kind,
    profile.mode,
    profile.command,
    PROFILE_ID,
  );
  return loadAgentProfile(db);
}
