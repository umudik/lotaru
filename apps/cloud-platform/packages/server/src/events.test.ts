import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CLOCK_TICK_MS,
  EVENT_APP_STARTED,
  EVENT_CLOCK_TICK,
  EVENT_FILE_CHANGED,
  EVENT_GITHUB_PR_OPENED,
  canonicalBusEventType,
  eventRunReason,
  eventTypeForTrigger,
  isBusEventType,
  relativeWatchPath,
  replayPayloadsFromStored,
  scriptListensToEvent,
  watchPathMatchesGlob,
} from "./events.js";

function listener(patch: {
  id?: string;
  projectId?: string;
  triggerType?: string;
  triggerGlob?: string;
  triggerBusEvent?: string;
  enabled?: boolean;
}): {
  id: string;
  projectId: string;
  triggerType: string;
  triggerGlob: string;
  triggerBusEvent: string;
  enabled: boolean;
} {
  const base = {
    id: "script-a",
    projectId: "proj-a",
    triggerType: "manual",
    triggerGlob: "",
    triggerBusEvent: "",
    enabled: true,
  };
  return Object.assign({}, base, patch);
}

describe("clock catalog", () => {
  it("ticks every ten seconds", () => {
    assert.equal(CLOCK_TICK_MS, 10000);
  });
});

describe("eventTypeForTrigger", () => {
  it("maps listeners onto catalog events and keeps run off the bus", () => {
    assert.equal(eventTypeForTrigger("manual"), "");
    assert.equal(eventTypeForTrigger("scheduled"), EVENT_CLOCK_TICK);
    assert.equal(eventTypeForTrigger("save"), EVENT_FILE_CHANGED);
    assert.equal(eventTypeForTrigger("startup"), EVENT_APP_STARTED);
    assert.equal(eventTypeForTrigger("github"), "");
  });
});

describe("canonicalBusEventType", () => {
  it("maps leftover schedule rows onto the clock and drops manual", () => {
    assert.equal(canonicalBusEventType("schedule.fired"), EVENT_CLOCK_TICK);
    assert.equal(canonicalBusEventType("manual"), "");
    assert.equal(canonicalBusEventType(EVENT_CLOCK_TICK), EVENT_CLOCK_TICK);
    assert.equal(isBusEventType("schedule.fired"), true);
    assert.equal(isBusEventType("manual"), false);
    assert.equal(isBusEventType("not.an.event"), false);
  });
});

describe("replayPayloadsFromStored", () => {
  it("replays through current listeners with an empty script target", () => {
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
    assert.equal(first.scriptId, "");
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
    assert.equal(first.scriptId, "");
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
