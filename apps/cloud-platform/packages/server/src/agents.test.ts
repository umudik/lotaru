import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scheduleIsDue } from "./modules/agents.js";

describe("scheduleIsDue", () => {
  it("is false before scheduled hour", () => {
    const now = new Date(2026, 7, 21, 20, 59, 0);
    assert.equal(scheduleIsDue({ scheduleHour: 21, scheduleMinute: 0 }, now), false);
  });

  it("is true at scheduled minute", () => {
    const now = new Date(2026, 7, 21, 21, 0, 0);
    assert.equal(scheduleIsDue({ scheduleHour: 21, scheduleMinute: 0 }, now), true);
  });

  it("is true after scheduled time same day", () => {
    const now = new Date(2026, 7, 21, 22, 15, 0);
    assert.equal(scheduleIsDue({ scheduleHour: 21, scheduleMinute: 0 }, now), true);
  });
});
