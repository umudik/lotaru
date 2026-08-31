import Database from "better-sqlite3";
import { agentEventType } from "./events.js";
import { cachedSqlite } from "./sqlite-cache.js";

/**
 * An agent whose action is "event" mints an event type the same way a rule
 * does. The event-type picker and the events log both need that list without
 * pulling in the agents module, so this is a read-only view of the one table
 * that module owns.
 */
export type AgentEventSource = {
  id: string;
  slug: string;
  title: string;
  eventType: string;
  enabled: boolean;
};

type SourceRow = {
  id: string;
  slug: string;
  title: string;
  enabled: number;
};

function openAgentEventDb(databasePath: string): Database.Database {
  return cachedSqlite("agent-events", databasePath, () => {
    return;
  });
}

function agentsTableReady(db: Database.Database): boolean {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lotaru_agents'")
    .get() as { name: string } | undefined;
  if (table === undefined) {
    return false;
  }
  const columns = db.prepare("PRAGMA table_info(lotaru_agents)").all() as { name: string }[];
  for (const column of columns) {
    if (column.name === "slug") {
      return true;
    }
  }
  return false;
}

/** Every agent in the project that writes its reply back to the bus. */
export function listAgentEventSources(
  databasePath: string,
  projectId: string,
): AgentEventSource[] {
  const db = openAgentEventDb(databasePath);
  if (agentsTableReady(db) !== true) {
    return [];
  }
  const rows = db
    .prepare(
      "SELECT id, slug, title, enabled FROM lotaru_agents WHERE project_id = ? AND action = 'event' AND TRIM(slug) <> '' ORDER BY created_at ASC",
    )
    .all(projectId) as SourceRow[];
  const sources: AgentEventSource[] = [];
  for (const row of rows) {
    sources.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      eventType: agentEventType(row.slug),
      enabled: row.enabled === 1,
    });
  }
  return sources;
}

/** Label lookup so a picker can show "Daily digest" instead of a raw slug. */
export function agentEventLabels(
  databasePath: string,
  projectId: string,
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const source of listAgentEventSources(databasePath, projectId)) {
    labels[source.eventType] = source.title;
  }
  return labels;
}
