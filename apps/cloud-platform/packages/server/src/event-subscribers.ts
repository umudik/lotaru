import Database from "better-sqlite3";
import { cachedSqlite } from "./sqlite-cache.js";
import { canonicalBusEventType, eventTypeForTrigger } from "./events.js";

export type SubscriberKind = "agent" | "script" | "knowledge";

export type EventSubscriber = {
  kind: SubscriberKind;
  id: string;
  label: string;
  enabled: boolean;
  eventType: string;
};

type SubscriberRow = {
  id: string;
  label: string;
  enabled: number;
  event_type: string;
  trigger_kind: string;
};

/**
 * Every table that can subscribe to a bus event lives in the one Lotaru
 * database, so this is a read-only view across all of them.
 */
const SOURCES: {
  kind: SubscriberKind;
  table: string;
  columns: string;
  /**
   * The event a row listens for. Scripts and agents spell some subscriptions as
   * a trigger kind rather than an event name — "scheduled" is clock.tick — so
   * those names resolve here instead of being treated as a separate mechanism.
   */
  resolve(row: SubscriberRow): string;
}[] = [
  {
    kind: "agent",
    table: "lotaru_agents",
    columns: "id AS id, title AS label, enabled AS enabled, event_type, trigger_kind",
    resolve: (row) => {
      if (row.trigger_kind === "event") {
        return row.event_type;
      }
      // A daily agent wakes on the clock like a scheduled script does.
      return eventTypeForTrigger("scheduled");
    },
  },
  {
    kind: "script",
    table: "script_scripts",
    columns:
      "id AS id, name AS label, enabled AS enabled, trigger_bus_event AS event_type, trigger_type AS trigger_kind",
    resolve: (row) => {
      if (row.trigger_kind === "event") {
        return row.event_type;
      }
      return eventTypeForTrigger(row.trigger_kind);
    },
  },
  {
    kind: "knowledge",
    table: "knowledge_templates",
    columns: "id AS id, title AS label, enabled AS enabled, event_type, '' AS trigger_kind",
    resolve: (row) => row.event_type,
  },
];

function openSubscriberDb(databasePath: string): Database.Database {
  // Read-only view: every table here is created and migrated by its own module.
  return cachedSqlite("event-subscribers", databasePath, () => {
    return;
  });
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return row !== undefined;
}

function readSubscribers(databasePath: string, projectId: string): EventSubscriber[] {
  const db = openSubscriberDb(databasePath);
  const subscribers: EventSubscriber[] = [];
  for (const source of SOURCES) {
    if (tableExists(db, source.table) !== true) {
      continue;
    }
    const rows = db
      .prepare(`SELECT ${source.columns} FROM ${source.table} WHERE project_id = ?`)
      .all(projectId) as SubscriberRow[];
    for (const row of rows) {
      const eventType = canonicalBusEventType(source.resolve(row));
      if (eventType.length === 0) {
        continue;
      }
      let label = String(row.label).trim();
      if (label.length === 0) {
        label = source.kind;
      }
      subscribers.push({
        kind: source.kind,
        id: String(row.id),
        label,
        enabled: row.enabled === 1,
        eventType,
      });
    }
  }
  return subscribers;
}

/** Everything in the project wired to this event type, enabled or not. */
export function listEventSubscribers(input: {
  databasePath: string;
  projectId: string;
  eventType: string;
}): EventSubscriber[] {
  const wanted = canonicalBusEventType(input.eventType);
  if (wanted.length === 0) {
    return [];
  }
  const matching: EventSubscriber[] = [];
  for (const subscriber of readSubscribers(input.databasePath, input.projectId)) {
    if (subscriber.eventType === wanted) {
      matching.push(subscriber);
    }
  }
  return matching;
}

/** Subscriber counts for every event type the project has wired up. */
export function countSubscribersByEvent(input: {
  databasePath: string;
  projectId: string;
}): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const subscriber of readSubscribers(input.databasePath, input.projectId)) {
    const current = counts[subscriber.eventType];
    counts[subscriber.eventType] = current === undefined ? 1 : current + 1;
  }
  return counts;
}

export function describeSubscribers(subscribers: readonly EventSubscriber[]): string {
  const parts: string[] = [];
  for (const subscriber of subscribers) {
    parts.push(`${subscriber.kind} "${subscriber.label}"`);
  }
  return parts.join(", ");
}
