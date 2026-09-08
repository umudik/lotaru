import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { calendarHitsNow, parseCalendarCron } from "./calendar-schedule.js";
import { clockAtEventType } from "./events.js";
import { SLUG_PATTERN, slugifyName } from "./slug.js";
import { cachedSqlite } from "./sqlite-cache.js";

export type ClockSchedule = {
  id: string;
  slug: string;
  title: string;
  cron: string;
  eventType: string;
  builtin: boolean;
  enabled: boolean;
  createdAt: number;
};

export type ClockAtDue = {
  slug: string;
  title: string;
};

type ClockSeed = {
  slug: string;
  title: string;
  cron: string;
};

export const DEFAULT_CLOCK_SCHEDULES: readonly ClockSeed[] = [
  { slug: "hourly", title: "Every hour at :00", cron: "0 * * * *" },
  { slug: "hourly-30", title: "Every hour at :30", cron: "30 * * * *" },
  { slug: "daily-09", title: "Every day at 9:00", cron: "0 9 * * *" },
  { slug: "daily-12", title: "Every day at 12:00", cron: "0 12 * * *" },
  { slug: "daily-18", title: "Every day at 18:00", cron: "0 18 * * *" },
  { slug: "daily-21", title: "Every day at 21:00", cron: "0 21 * * *" },
  { slug: "weekdays-09", title: "Weekdays at 9:00", cron: "0 9 * * 1-5" },
  { slug: "weekdays-18", title: "Weekdays at 18:00", cron: "0 18 * * 1-5" },
  { slug: "monday-09", title: "Monday at 9:00", cron: "0 9 * * 1" },
  { slug: "monday-15", title: "Monday at 15:00", cron: "0 15 * * 1" },
  { slug: "friday-17", title: "Friday at 17:00", cron: "0 17 * * 5" },
  { slug: "saturday-10", title: "Saturday at 10:00", cron: "0 10 * * 6" },
  { slug: "sunday-20", title: "Sunday at 20:00", cron: "0 20 * * 0" },
  { slug: "month-start", title: "1st of the month at 9:00", cron: "0 9 1 * *" },
  { slug: "month-mid", title: "15th of the month at 9:00", cron: "0 9 15 * *" },
  { slug: "new-year", title: "1 January at 00:00", cron: "0 0 1 1 *" },
];

const clockScheduleRowSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(SLUG_PATTERN),
  title: z.string().min(1),
  cron: z.string().min(1),
  builtin: z.number().int().min(0).max(1),
  enabled: z.number().int().min(0).max(1),
  created_at: z.number().int(),
});

const slugIdRowSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(SLUG_PATTERN),
});

function requireCron(expression: string): string {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    throw new Error("Invalid calendar schedule");
  }
  parseCalendarCron(trimmed);
  return trimmed;
}

function presentClockSchedule(row: z.infer<typeof clockScheduleRowSchema>): ClockSchedule {
  const builtin = row.builtin === 1;
  const enabled = row.enabled === 1;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    cron: row.cron,
    eventType: clockAtEventType(row.slug),
    builtin,
    enabled,
    createdAt: row.created_at,
  };
}

function listedSlugs(db: Database.Database, exceptId: string): readonly string[] {
  const rows = db.prepare("SELECT id, slug FROM clock_schedules").all();
  const slugs: string[] = [];
  for (const raw of rows) {
    const parsed = slugIdRowSchema.safeParse(raw);
    if (parsed.success !== true) {
      continue;
    }
    if (parsed.data.id === exceptId) {
      continue;
    }
    slugs.push(parsed.data.slug);
  }
  return slugs;
}

export function uniqueClockSlug(
  db: Database.Database,
  requested: string,
  exceptId: string,
): string {
  const base = slugifyName(requested);
  if (base.length === 0) {
    throw new Error("Name must contain letters or digits");
  }
  const existing = listedSlugs(db, exceptId);
  if (existing.includes(base) !== true) {
    return base;
  }
  let counter = 2;
  while (counter < 100) {
    const candidate = `${base}-${String(counter)}`;
    if (existing.includes(candidate) !== true) {
      return candidate;
    }
    counter += 1;
  }
  throw new Error("Could not derive a unique clock id");
}

function seedBuiltinClockSchedules(db: Database.Database): void {
  const now = Date.now();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO clock_schedules (id, slug, title, cron, builtin, enabled, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)",
  );
  for (const listed of DEFAULT_CLOCK_SCHEDULES) {
    parseCalendarCron(listed.cron);
    insert.run(`clock-at-${listed.slug}`, listed.slug, listed.title, listed.cron, now);
  }
}

function migrateClockSchedules(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clock_schedules (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      cron TEXT NOT NULL,
      builtin INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  seedBuiltinClockSchedules(db);
}

export function openClockScheduleDb(databasePath: string): Database.Database {
  if (databasePath.trim().length === 0) {
    throw new Error("clock schedule database path required");
  }
  const db = cachedSqlite("clock-schedules", databasePath, migrateClockSchedules);
  if (db.open !== true) {
    throw new Error("clock schedule database failed to open");
  }
  return db;
}

export function listClockSchedules(db: Database.Database): ClockSchedule[] {
  const rows = db
    .prepare("SELECT id, slug, title, cron, builtin, enabled, created_at FROM clock_schedules ORDER BY builtin DESC, title ASC")
    .all();
  const listed: ClockSchedule[] = [];
  for (const raw of rows) {
    const parsed = clockScheduleRowSchema.safeParse(raw);
    if (parsed.success !== true) {
      continue;
    }
    listed.push(presentClockSchedule(parsed.data));
  }
  return listed;
}

export function listEnabledClockSchedules(databasePath: string): ClockSchedule[] {
  const db = openClockScheduleDb(databasePath);
  const listed: ClockSchedule[] = [];
  for (const row of listClockSchedules(db)) {
    if (row.enabled !== true) {
      continue;
    }
    listed.push(row);
  }
  return listed;
}

export function getClockSchedule(db: Database.Database, id: string): ClockSchedule | null {
  const raw = db
    .prepare(
      "SELECT id, slug, title, cron, builtin, enabled, created_at FROM clock_schedules WHERE id = ?",
    )
    .get(id);
  const parsed = clockScheduleRowSchema.safeParse(raw);
  if (parsed.success !== true) {
    return null;
  }
  return presentClockSchedule(parsed.data);
}

export function createClockSchedule(
  db: Database.Database,
  title: string,
  cron: string,
): ClockSchedule {
  const trimmedTitle = title.trim();
  if (trimmedTitle.length === 0) {
    throw new Error("Title required");
  }
  const encoded = requireCron(cron);
  const slug = uniqueClockSlug(db, trimmedTitle, "");
  const id = randomUUID();
  const createdAt = Date.now();
  db.prepare(
    "INSERT INTO clock_schedules (id, slug, title, cron, builtin, enabled, created_at) VALUES (?, ?, ?, ?, 0, 1, ?)",
  ).run(id, slug, trimmedTitle, encoded, createdAt);
  const created = getClockSchedule(db, id);
  if (created === null) {
    throw new Error("Clock time was not saved");
  }
  return created;
}

export function patchClockSchedule(
  db: Database.Database,
  id: string,
  input: { title?: string; cron?: string; enabled?: boolean },
): ClockSchedule {
  const existing = getClockSchedule(db, id);
  if (existing === null) {
    throw new Error("not found");
  }
  let title = existing.title;
  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (trimmed.length === 0) {
      throw new Error("Title required");
    }
    title = trimmed;
  }
  let cron = existing.cron;
  if (input.cron !== undefined) {
    cron = requireCron(input.cron);
  }
  let enabled = existing.enabled;
  if (input.enabled !== undefined) {
    enabled = input.enabled;
  }
  db.prepare("UPDATE clock_schedules SET title = ?, cron = ?, enabled = ? WHERE id = ?").run(
    title,
    cron,
    enabled ? 1 : 0,
    id,
  );
  const saved = getClockSchedule(db, id);
  if (saved === null) {
    throw new Error("Clock time was not saved");
  }
  return saved;
}

export function deleteClockSchedule(db: Database.Database, id: string): void {
  const existing = getClockSchedule(db, id);
  if (existing === null) {
    throw new Error("not found");
  }
  if (existing.builtin === true) {
    throw new Error("Built-in clock times cannot be deleted");
  }
  db.prepare("DELETE FROM clock_schedules WHERE id = ?").run(id);
}

export function dueClockAtEvents(databasePath: string, now: Date): readonly ClockAtDue[] {
  const db = openClockScheduleDb(databasePath);
  const due: ClockAtDue[] = [];
  for (const row of listClockSchedules(db)) {
    if (row.enabled !== true) {
      continue;
    }
    try {
      const spec = parseCalendarCron(row.cron);
      if (calendarHitsNow(spec, now) !== true) {
        continue;
      }
      due.push({ slug: row.slug, title: row.title });
    } catch {
      continue;
    }
  }
  return due;
}
