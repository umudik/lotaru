import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CLOCK_INTERVALS,
  CLOCK_INTERVAL_TYPES,
  CLOCK_TICK_MS,
  EVENT_APP_STARTED,
  EVENT_CLOCK_EVERY_1M,
  EVENT_CLOCK_TICK,
  EVENT_FILE_CHANGED,
  EVENT_GITHUB_PR_OPENED,
  EVENT_INGEST_ALARM,
  canonicalBusEventType,
  clockIntervalLabel,
  clockTypesDue,
  eventRunReason,
  isClockEventType,
  listenTypesForTriggerKind,
  subscriptionBusTypes,
  isBusEventType,
  isClockAtEventType,
  isMintedEventType,
  relativeWatchPath,
  scriptListensToEvent,
  watchPathMatchesGlob,
} from "./events.js";
import { replayPayloadsFromStored } from "./event-publish.js";

function listener(patch: {
  id?: string;
  projectId?: string;
  triggerType?: string;
  triggerGlob?: string;
  triggerBusEvent?: string;
  triggerCron?: string;
  enabled?: boolean;
}): {
  id: string;
  projectId: string;
  triggerType: string;
  triggerGlob: string;
  triggerBusEvent: string;
  triggerCron: string;
  enabled: boolean;
} {
  const base = {
    id: "script-a",
    projectId: "proj-a",
    triggerType: "manual",
    triggerGlob: "",
    triggerBusEvent: "",
    triggerCron: "",
    enabled: true,
  };
  return Object.assign({}, base, patch);
}

describe("clock catalog", () => {
  it("pulses every five seconds and lists many intervals", () => {
    assert.equal(CLOCK_TICK_MS, 5000);
    assert.equal(CLOCK_INTERVALS.length >= 15, true);
    assert.equal(CLOCK_INTERVAL_TYPES.length, CLOCK_INTERVALS.length);
    for (let i = 0; i < CLOCK_INTERVALS.length; i += 1) {
      const listed = CLOCK_INTERVALS[i];
      const type = CLOCK_INTERVAL_TYPES[i];
      if (listed === undefined || type === undefined) {
        assert.fail("clock interval tables drifted");
        return;
      }
      assert.equal(listed.type, type);
    }
    assert.equal(isClockEventType("clock.every_1h"), true);
    assert.equal(isClockEventType("schedule.fired"), true);
    assert.equal(isClockEventType("clock.at.hourly"), false);
    assert.equal(isClockAtEventType("clock.at.hourly"), true);
    assert.equal(isMintedEventType("clock.at.monday-15"), true);
    assert.equal(clockIntervalLabel("clock.every_5s"), "Every 5 seconds");
    assert.deepEqual(clockTypesDue(0, 0), [EVENT_CLOCK_TICK]);
    const dueAtTen = clockTypesDue(10_000, 5_000);
    assert.equal(dueAtTen.includes("clock.every_5s"), true);
    assert.equal(dueAtTen.includes(EVENT_CLOCK_TICK), true);
    assert.equal(dueAtTen.includes("clock.every_1h"), false);
  });
});

describe("listenTypesForTriggerKind", () => {
  it("maps listener kinds onto catalog events and keeps run off the bus", () => {
    assert.deepEqual(listenTypesForTriggerKind("manual"), []);
    assert.deepEqual(listenTypesForTriggerKind("schedule"), [EVENT_CLOCK_TICK]);
    assert.deepEqual(listenTypesForTriggerKind("save"), [EVENT_FILE_CHANGED]);
    assert.deepEqual(listenTypesForTriggerKind("startup"), [EVENT_APP_STARTED]);
    assert.deepEqual(listenTypesForTriggerKind("github"), []);
    assert.deepEqual(listenTypesForTriggerKind("event"), []);
    assert.deepEqual(subscriptionBusTypes("event", "voice.rule.hatirlatma"), [
      "voice.rule.hatirlatma",
    ]);
    assert.deepEqual(subscriptionBusTypes("scheduled", "clock.at.monday-15"), [
      "clock.at.monday-15",
    ]);
    assert.deepEqual(subscriptionBusTypes("event", "clock.at.hourly"), ["clock.at.hourly"]);
    assert.deepEqual(subscriptionBusTypes("event", ""), []);
    assert.deepEqual(subscriptionBusTypes("manual", ""), []);
  });
});

describe("canonicalBusEventType", () => {
  it("maps leftover schedule rows onto the clock and drops manual", () => {
    assert.equal(canonicalBusEventType("schedule.fired"), EVENT_CLOCK_TICK);
    assert.equal(canonicalBusEventType("manual"), "manual");
    assert.equal(canonicalBusEventType(EVENT_CLOCK_TICK), EVENT_CLOCK_TICK);
    assert.equal(isBusEventType("schedule.fired"), true);
    assert.equal(isBusEventType("clock.at.hourly"), true);
    assert.equal(isBusEventType("manual"), false);
    assert.equal(isBusEventType("not.an.event"), false);
  });
});

describe("replayPayloadsFromStored", () => {
  it("replays a clock tick without a script target", () => {
    const payloads = replayPayloadsFromStored({
      id: "e-old",
      type: "schedule.fired",
      projectId: "proj-a",
      scriptId: "script-a",
      path: "",
      detail: "* * * * *",
      createdAt: 1,
    });
    assert.equal(payloads.length, 1);
    const first = payloads[0];
    if (first === undefined) {
      assert.fail("expected a replay payload");
      return;
    }
    assert.equal(first.type, EVENT_CLOCK_TICK);
    assert.equal("scriptId" in first, false);
    assert.equal(first.projectId, "proj-a");
  });

  it("refuses a command that was never a catalog event", () => {
    const payloads = replayPayloadsFromStored({
      id: "e-run",
      type: "manual",
      projectId: "proj-a",
      scriptId: "script-a",
      path: "",
      detail: "user",
      createdAt: 1,
    });
    assert.equal(payloads.length, 0);
  });

  it("keeps GitHub occurrence path and detail for a pipeline re-run", () => {
    const payloads = replayPayloadsFromStored({
      id: "e-pr",
      type: EVENT_GITHUB_PR_OPENED,
      projectId: "proj-a",
      scriptId: "",
      path: "umudik/lotaru",
      detail: "12",
      createdAt: 1,
    });
    assert.equal(payloads.length, 1);
    const first = payloads[0];
    if (first === undefined) {
      assert.fail("expected a replay payload");
      return;
    }
    assert.equal(first.type, EVENT_GITHUB_PR_OPENED);
    assert.equal(first.path, "umudik/lotaru");
    assert.equal(first.detail, "12");
    assert.equal("scriptId" in first, false);
  });
});

describe("scriptListensToEvent", () => {
  it("does not put a Run command on the bus", () => {
    const clock = {
      id: "e1",
      type: EVENT_CLOCK_TICK,
      projectId: "proj-a",
      scriptId: "",
      path: "",
      detail: "",
      createdAt: 1,
    };
    assert.equal(scriptListensToEvent(listener({ triggerType: "manual" }), clock), false);
  });

  it("runs every scheduled script in the project on a clock tick", () => {
    const event = {
      id: "e-clock",
      type: EVENT_CLOCK_TICK,
      projectId: "proj-a",
      scriptId: "",
      path: "",
      detail: "",
      createdAt: 1,
    };
    assert.equal(scriptListensToEvent(listener({ triggerType: "scheduled" }), event), true);
    assert.equal(
      scriptListensToEvent(listener({ triggerType: "scheduled", projectId: "other" }), event),
      false,
    );
    assert.equal(scriptListensToEvent(listener({ triggerType: "startup" }), event), false);
    const hourly = {
      id: "e-hour",
      type: "clock.every_1h",
      projectId: "proj-a",
      scriptId: "",
      path: "",
      detail: "",
      createdAt: 1,
    };
    assert.equal(scriptListensToEvent(listener({ triggerType: "scheduled" }), hourly), false);
    assert.equal(
      scriptListensToEvent(
        listener({ triggerType: "scheduled", triggerBusEvent: "clock.every_1h" }),
        hourly,
      ),
      true,
    );
    assert.equal(
      scriptListensToEvent(
        listener({ triggerType: "scheduled", triggerBusEvent: "clock.every_1h" }),
        event,
      ),
      false,
    );
  });

  it("runs a calendar script only on the matching minute of clock.every_1m", () => {
    const mondays = {
      triggerType: "scheduled",
      triggerBusEvent: EVENT_CLOCK_EVERY_1M,
      triggerCron: "0 9 * * 1",
    };
    const mondayMorning = {
      id: "e-cal-mon",
      type: EVENT_CLOCK_EVERY_1M,
      projectId: "proj-a",
      scriptId: "",
      path: "",
      detail: "",
      createdAt: new Date(2026, 8, 7, 9, 0, 20).getTime(),
    };
    const mondayTick = {
      id: "e-cal-tick",
      type: EVENT_CLOCK_TICK,
      projectId: "proj-a",
      scriptId: "",
      path: "",
      detail: "",
      createdAt: new Date(2026, 8, 7, 9, 0, 20).getTime(),
    };
    const fiveSeconds = {
      id: "e-cal-5s",
      type: "clock.every_5s",
      projectId: "proj-a",
      scriptId: "",
      path: "",
      detail: "",
      createdAt: new Date(2026, 8, 7, 9, 0, 20).getTime(),
    };
    const tuesdayMorning = {
      id: "e-cal-tue",
      type: EVENT_CLOCK_EVERY_1M,
      projectId: "proj-a",
      scriptId: "",
      path: "",
      detail: "",
      createdAt: new Date(2026, 8, 8, 9, 0, 0).getTime(),
    };
    assert.equal(scriptListensToEvent(listener(mondays), mondayMorning), true);
    assert.equal(scriptListensToEvent(listener(mondays), mondayTick), false);
    assert.equal(scriptListensToEvent(listener(mondays), fiveSeconds), false);
    assert.equal(scriptListensToEvent(listener(mondays), tuesdayMorning), false);
  });

  it("runs every startup script in the project when scriptId is empty", () => {
    const event = {
      id: "e2",
      type: EVENT_APP_STARTED,
      projectId: "proj-a",
      scriptId: "",
      path: "",
      detail: "boot",
      createdAt: 1,
    };
    assert.equal(scriptListensToEvent(listener({ triggerType: "startup" }), event), true);
    assert.equal(scriptListensToEvent(listener({ triggerType: "startup", projectId: "other" }), event), false);
    assert.equal(scriptListensToEvent(listener({ triggerType: "manual" }), event), false);
  });

  it("matches on-save scripts by glob and ignores GitHub until a script listens", () => {
    const fileEvent = {
      id: "e4",
      type: EVENT_FILE_CHANGED,
      projectId: "proj-a",
      scriptId: "",
      path: "src/foo.ts",
      detail: "change",
      createdAt: 1,
    };
    assert.equal(
      scriptListensToEvent(listener({ triggerType: "save", triggerGlob: "**/*.ts" }), fileEvent),
      true,
    );
    assert.equal(
      scriptListensToEvent(listener({ triggerType: "save", triggerGlob: "**/*.md" }), fileEvent),
      false,
    );
    const github = {
      id: "e5",
      type: EVENT_GITHUB_PR_OPENED,
      projectId: "proj-a",
      scriptId: "",
      path: "",
      detail: "42",
      createdAt: 1,
    };
    assert.equal(scriptListensToEvent(listener({ triggerType: "save" }), github), false);
    assert.equal(scriptListensToEvent(listener({ triggerType: "manual" }), github), false);
  });

  it("skips disabled scripts", () => {
    const event = {
      id: "e6",
      type: EVENT_CLOCK_TICK,
      projectId: "proj-a",
      scriptId: "",
      path: "",
      detail: "",
      createdAt: 1,
    };
    assert.equal(scriptListensToEvent(listener({ triggerType: "scheduled", enabled: false }), event), false);
  });
});

describe("watchPathMatchesGlob", () => {
  it("treats an empty glob as match-all", () => {
    assert.equal(watchPathMatchesGlob("src/a.ts", ""), true);
  });

  it("normalizes separators against the project root", () => {
    const root = process.cwd();
    const filePath = join(root, "src", "a.ts");
    const rel = relativeWatchPath(root, filePath);
    assert.equal(rel, "src/a.ts");
    assert.equal(watchPathMatchesGlob("src/a.ts", "**/*.ts"), true);
  });
});

describe("eventRunReason", () => {
  it("names clock ticks and file saves for the execution log", () => {
    assert.equal(
      eventRunReason({
        id: "e",
        type: EVENT_CLOCK_TICK,
        projectId: "p",
        scriptId: "",
        path: "",
        detail: "",
        createdAt: 1,
      }),
      "clock",
    );
    assert.equal(
      eventRunReason({
        id: "e",
        type: EVENT_FILE_CHANGED,
        projectId: "p",
        scriptId: "",
        path: "src/a.ts",
        detail: "change",
        createdAt: 1,
      }),
      "save:src/a.ts",
    );
    assert.equal(
      eventRunReason({
        id: "e",
        type: EVENT_INGEST_ALARM,
        projectId: "p",
        scriptId: "",
        path: "behind",
        detail: "Catch-up is behind",
        createdAt: 1,
      }),
      "ingest.alarm:behind",
    );
  });
});

describe("bus event script trigger", () => {
  it("matches explicit bus event subscriptions", () => {
    const taskEvent = {
      id: "e-task",
      type: "task.created",
      projectId: "proj-a",
      scriptId: "",
      path: "42",
      detail: "Voice follow-up",
      createdAt: 1,
    };
    assert.equal(
      scriptListensToEvent(
        listener({ triggerType: "event", triggerBusEvent: "task.created" }),
        taskEvent,
      ),
      true,
    );
    assert.equal(
      scriptListensToEvent(
        listener({ triggerType: "event", triggerBusEvent: "voice.segment.final" }),
        taskEvent,
      ),
      false,
    );
  });

  it("never lets a script hear its own script.ran", () => {
    const ranEvent = {
      id: "e-ran",
      type: "script.ran",
      projectId: "proj-a",
      scriptId: "s1",
      path: "exec-1",
      detail: "success",
      createdAt: 1,
    };
    assert.equal(
      scriptListensToEvent(
        Object.assign(listener({ triggerType: "event", triggerBusEvent: "script.ran" }), {
          id: "s1",
        }),
        ranEvent,
      ),
      false,
    );
    assert.equal(
      scriptListensToEvent(
        Object.assign(listener({ triggerType: "event", triggerBusEvent: "script.ran" }), {
          id: "s2",
        }),
        ranEvent,
      ),
      true,
    );
  });

  it("aliases note.page.written to note.page.created", () => {
    assert.equal(canonicalBusEventType("note.page.written"), "note.page.created");
  });
});
