import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createClockSchedule,
  DEFAULT_CLOCK_SCHEDULES,
  deleteClockSchedule,
  dueClockAtEvents,
  listClockSchedules,
  openClockScheduleDb,
  patchClockSchedule,
} from "./clock-schedule.js";
import { clockAtEventType, isClockAtEventType } from "./events.js";
import { parseCalendarCron } from "./calendar-schedule.js";

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-clock-"));
  return join(dir, "app.sqlite");
}

describe("clock schedules", () => {
  it("seeds builtin unix five-field times as clock.at events", () => {
    const db = openClockScheduleDb(tempDb());
    const listed = listClockSchedules(db);
    assert.equal(listed.length >= 16, true);
    assert.equal(DEFAULT_CLOCK_SCHEDULES.length, 16);
    for (const seed of DEFAULT_CLOCK_SCHEDULES) {
      parseCalendarCron(seed.cron);
      const hits = listed.filter((row) => row.slug === seed.slug);
      assert.equal(hits.length, 1);
      const row = hits[0];
      if (row === undefined) {
        assert.fail("missing builtin clock time");
        return;
      }
      assert.equal(row.builtin, true);
      assert.equal(row.enabled, true);
      assert.equal(row.eventType, clockAtEventType(seed.slug));
      assert.equal(isClockAtEventType(row.eventType), true);
    }
    const again = listClockSchedules(openClockScheduleDb(db.name));
    assert.equal(again.length, listed.length);
  });

  it("fires monday-15 on that minute only", () => {
    const path = tempDb();
    openClockScheduleDb(path);
    const monday = new Date(2026, 8, 7, 15, 0, 0);
    const tuesday = new Date(2026, 8, 8, 15, 0, 0);
    const mondayHits = dueClockAtEvents(path, monday);
    const slugs: string[] = [];
    for (const hit of mondayHits) {
      slugs.push(hit.slug);
    }
    assert.equal(slugs.includes("monday-15"), true);
    assert.equal(slugs.includes("hourly"), true);
    const tuesdayHits = dueClockAtEvents(path, tuesday);
    const tuesdaySlugs: string[] = [];
    for (const hit of tuesdayHits) {
      tuesdaySlugs.push(hit.slug);
    }
    assert.equal(tuesdaySlugs.includes("monday-15"), false);
  });

  it("appends -2 when a custom title collides with a builtin slug", () => {
    const db = openClockScheduleDb(tempDb());
    const created = createClockSchedule(db, "Hourly", "0 7 * * *");
    assert.equal(created.slug, "hourly-2");
    assert.equal(created.builtin, false);
    assert.equal(created.eventType, "clock.at.hourly-2");
    patchClockSchedule(db, created.id, { enabled: false });
    const disabled = dueClockAtEvents(db.name, new Date(2026, 8, 7, 7, 0, 0));
    const slugs: string[] = [];
    for (const hit of disabled) {
      slugs.push(hit.slug);
    }
    assert.equal(slugs.includes("hourly-2"), false);
    deleteClockSchedule(db, created.id);
    let builtinId = "";
    for (const row of listClockSchedules(db)) {
      if (row.slug === "hourly") {
        builtinId = row.id;
      }
    }
    assert.equal(builtinId.length > 0, true);
    assert.throws(() => {
      deleteClockSchedule(db, builtinId);
    }, /Built-in/);
  });
});
