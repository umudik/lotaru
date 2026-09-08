import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calendarClaimStamp,
  calendarDueToday,
  calendarFromParts,
  calendarHitsNow,
  calendarToCron,
  calendarToggleWeekday,
  calendarWithPeriod,
  dailyCalendar,
  formatCalendarSchedule,
  parseCalendarCron,
} from "./calendar-schedule.js";

const SRC = dirname(fileURLToPath(import.meta.url));
const WEB_SCHEDULE = join(SRC, "..", "..", "web", "src", "lib", "calendar-schedule.ts");

describe("calendar schedule", () => {
  it("encodes unix five-field cron without mixing day-of-month and day-of-week", () => {
    assert.equal(calendarToCron(dailyCalendar(21, 0)), "0 21 * * *");
    assert.equal(
      calendarToCron({
        period: "hour",
        minute: 5,
        hour: 0,
        weekdays: [],
        monthDay: 1,
        month: 1,
      }),
      "5 * * * *",
    );
    assert.equal(
      calendarToCron({
        period: "week",
        minute: 0,
        hour: 9,
        weekdays: [1],
        monthDay: 1,
        month: 1,
      }),
      "0 9 * * 1",
    );
    assert.equal(
      calendarToCron({
        period: "week",
        minute: 30,
        hour: 9,
        weekdays: [1, 3, 5],
        monthDay: 1,
        month: 1,
      }),
      "30 9 * * 1,3,5",
    );
    assert.equal(
      calendarToCron({
        period: "month",
        minute: 0,
        hour: 8,
        weekdays: [],
        monthDay: 15,
        month: 1,
      }),
      "0 8 15 * *",
    );
    assert.equal(
      calendarToCron({
        period: "year",
        minute: 30,
        hour: 14,
        weekdays: [],
        monthDay: 15,
        month: 3,
      }),
      "30 14 15 3 *",
    );
  });

  it("round-trips each period through parse", () => {
    const expressions = ["5 * * * *", "0 21 * * *", "0 9 * * 1", "30 9 * * 1,3,5", "0 8 15 * *", "30 14 15 3 *"];
    for (const expression of expressions) {
      assert.equal(calendarToCron(parseCalendarCron(expression)), expression);
    }
    const ranged = parseCalendarCron("0 9 * * 1-5");
    assert.equal(ranged.period, "week");
    assert.deepEqual(ranged.weekdays, [1, 2, 3, 4, 5]);
  });

  it("treats Sunday as 0 or 7", () => {
    const fromSeven = parseCalendarCron("0 9 * * 7");
    assert.deepEqual(fromSeven.weekdays, [0]);
    assert.equal(calendarToCron(fromSeven), "0 9 * * 0");
  });

  it("refuses steps, six fields, and mixed day constraints", () => {
    assert.throws(() => parseCalendarCron("*/5 * * * *"));
    assert.throws(() => parseCalendarCron("0 9 * * * *"));
    assert.throws(() => parseCalendarCron("0 9 15 * 1"));
    assert.throws(() => parseCalendarCron(""));
    assert.throws(() => parseCalendarCron("0 9 * *"));
  });

  it("hits only the matching local minute for scripts", () => {
    const mondays = parseCalendarCron("0 9 * * 1");
    const mondayMorning = new Date(2026, 8, 7, 9, 0, 12);
    const mondayLater = new Date(2026, 8, 7, 9, 1, 0);
    const tuesdayMorning = new Date(2026, 8, 8, 9, 0, 0);
    assert.equal(mondayMorning.getDay(), 1);
    assert.equal(tuesdayMorning.getDay(), 2);
    assert.equal(calendarHitsNow(mondays, mondayMorning), true);
    assert.equal(calendarHitsNow(mondays, mondayLater), false);
    assert.equal(calendarHitsNow(mondays, tuesdayMorning), false);
    const yearly = parseCalendarCron("30 14 15 3 *");
    assert.equal(calendarHitsNow(yearly, new Date(2026, 2, 15, 14, 30, 0)), true);
    assert.equal(calendarHitsNow(yearly, new Date(2026, 2, 15, 14, 31, 0)), false);
    assert.equal(calendarHitsNow(yearly, new Date(2026, 2, 16, 14, 30, 0)), false);
    const hourly = parseCalendarCron("5 * * * *");
    assert.equal(calendarHitsNow(hourly, new Date(2026, 8, 8, 10, 5, 0)), true);
    assert.equal(calendarHitsNow(hourly, new Date(2026, 8, 8, 11, 5, 40)), true);
    assert.equal(calendarHitsNow(hourly, new Date(2026, 8, 8, 10, 6, 0)), false);
  });

  it("lets agents catch up later the same calendar day, not the next day", () => {
    const daily = dailyCalendar(21, 0);
    assert.equal(calendarDueToday(daily, new Date(2026, 7, 21, 20, 59, 0)), false);
    assert.equal(calendarDueToday(daily, new Date(2026, 7, 21, 21, 0, 0)), true);
    assert.equal(calendarDueToday(daily, new Date(2026, 7, 21, 22, 15, 0)), true);
    const mondays = parseCalendarCron("0 9 * * 1");
    assert.equal(calendarDueToday(mondays, new Date(2026, 8, 7, 9, 0, 0)), true);
    assert.equal(calendarDueToday(mondays, new Date(2026, 8, 7, 18, 0, 0)), true);
    assert.equal(calendarDueToday(mondays, new Date(2026, 8, 8, 18, 0, 0)), false);
    const yearly = parseCalendarCron("30 14 15 3 *");
    assert.equal(calendarDueToday(yearly, new Date(2026, 2, 15, 14, 30, 0)), true);
    assert.equal(calendarDueToday(yearly, new Date(2026, 2, 15, 16, 0, 0)), true);
    assert.equal(calendarDueToday(yearly, new Date(2026, 2, 16, 16, 0, 0)), false);
  });

  it("does not catch up missed hourly slots later in the hour", () => {
    const hourly = parseCalendarCron("5 * * * *");
    assert.equal(calendarDueToday(hourly, new Date(2026, 8, 8, 10, 5, 0)), true);
    assert.equal(calendarDueToday(hourly, new Date(2026, 8, 8, 10, 6, 0)), false);
    assert.equal(calendarClaimStamp(hourly, new Date(2026, 8, 8, 10, 5, 0)), "2026-09-08T10");
    assert.equal(calendarClaimStamp(dailyCalendar(21, 0), new Date(2026, 8, 8, 22, 0, 0)), "2026-09-08");
  });

  it("skips dates that do not exist on the wall clock", () => {
    const febTwentyNine = parseCalendarCron("0 9 29 2 *");
    assert.equal(calendarHitsNow(febTwentyNine, new Date(2024, 1, 29, 9, 0, 0)), true);
    assert.equal(calendarHitsNow(febTwentyNine, new Date(2026, 1, 28, 9, 0, 0)), false);
    assert.equal(calendarHitsNow(febTwentyNine, new Date(2026, 2, 1, 9, 0, 0)), false);
    const aprilThirtyOne = parseCalendarCron("0 9 31 4 *");
    assert.equal(calendarHitsNow(aprilThirtyOne, new Date(2026, 3, 30, 9, 0, 0)), false);
  });

  it("builds labels and weekday edits without emptying the week", () => {
    assert.equal(formatCalendarSchedule(dailyCalendar(21, 0)), "Every day at 21:00");
    assert.equal(
      formatCalendarSchedule(parseCalendarCron("0 9 * * 1")),
      "Mondays at 09:00",
    );
    assert.equal(
      formatCalendarSchedule(parseCalendarCron("30 14 15 3 *")),
      "15 March at 14:30",
    );
    const onlyMonday = parseCalendarCron("0 9 * * 1");
    const stillMonday = calendarToggleWeekday(onlyMonday, 1);
    assert.deepEqual(stillMonday.weekdays, [1]);
    const mondayWednesday = calendarToggleWeekday(onlyMonday, 3);
    assert.deepEqual(mondayWednesday.weekdays, [1, 3]);
    const hourly = calendarWithPeriod(dailyCalendar(21, 5), "hour");
    assert.equal(hourly.period, "hour");
    assert.equal(hourly.minute, 5);
  });

  it("falls back to daily hour and minute when cron is empty", () => {
    const spec = calendarFromParts("", 21, 0);
    assert.equal(spec.period, "day");
    assert.equal(calendarToCron(spec), "0 21 * * *");
  });

  it("stays in lockstep with the web copy", () => {
    const server = readFileSync(join(SRC, "calendar-schedule.ts"), "utf8");
    const web = readFileSync(WEB_SCHEDULE, "utf8");
    assert.equal(web, server);
  });
});
