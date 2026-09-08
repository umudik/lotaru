import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseLotaruPublish,
  storedEnvelopeFromPublish,
  replayPayloadsFromStored,
} from "./event-publish.js";
import {
  EVENT_CLOCK_TICK,
  EVENT_INGEST_ALARM,
  EVENT_SCRIPT_RAN,
  EVENT_TASK_CREATED,
} from "./events.js";

describe("parseLotaruPublish", () => {
  it("accepts a clock tick without unused columns", () => {
    const parsed = parseLotaruPublish({
      type: EVENT_CLOCK_TICK,
      projectId: "proj-a",
    });
    assert.equal(parsed.type, EVENT_CLOCK_TICK);
    assert.equal("scriptId" in parsed, false);
    assert.equal("path" in parsed, false);
  });

  it("accepts hourly clock intervals", () => {
    const parsed = parseLotaruPublish({
      type: "clock.every_1h",
      projectId: "proj-a",
    });
    assert.equal(parsed.type, "clock.every_1h");
  });

  it("refuses empty-string padding on a clock tick", () => {
    assert.throws(() => {
      parseLotaruPublish({
        type: EVENT_CLOCK_TICK,
        projectId: "proj-a",
        scriptId: "",
        path: "",
        detail: "",
      });
    });
  });

  it("encodes unused sqlite columns only at the storage boundary", () => {
    const stored = storedEnvelopeFromPublish({
      type: EVENT_CLOCK_TICK,
      projectId: "proj-a",
    });
    assert.equal(stored.scriptId, "");
    assert.equal(stored.path, "");
    assert.equal(stored.detail, "");
  });

  it("requires a script id on script.ran", () => {
    assert.throws(() => {
      parseLotaruPublish({
        type: EVENT_SCRIPT_RAN,
        projectId: "proj-a",
        path: "exec-1",
        detail: "success",
      });
    });
    const stored = storedEnvelopeFromPublish({
      type: EVENT_SCRIPT_RAN,
      projectId: "proj-a",
      scriptId: "script-a",
      path: "exec-1",
      detail: "success",
    });
    assert.equal(stored.scriptId, "script-a");
  });

  it("accepts minted rule events", () => {
    const stored = storedEnvelopeFromPublish({
      type: "voice.rule.hatirlatma",
      projectId: "proj-a",
      path: "Buy milk",
      detail: "Reminder from voice",
    });
    assert.equal(stored.type, "voice.rule.hatirlatma");
    assert.equal(stored.scriptId, "");
  });

  it("accepts an ingest alarm with a kind path", () => {
    const stored = storedEnvelopeFromPublish({
      type: EVENT_INGEST_ALARM,
      projectId: "proj-a",
      path: "behind",
      detail: "Catch-up is behind github",
    });
    assert.equal(stored.type, EVENT_INGEST_ALARM);
    assert.equal(stored.path, "behind");
    assert.throws(() => {
      parseLotaruPublish({
        type: EVENT_INGEST_ALARM,
        projectId: "proj-a",
        path: "behind",
        detail: "",
      });
    });
  });

  it("refuses an unknown type", () => {
    assert.throws(() => {
      parseLotaruPublish({
        type: EVENT_TASK_CREATED,
        projectId: "",
        path: "1",
        detail: "x",
      });
    });
    assert.throws(() => {
      parseLotaruPublish({
        type: "not.an.event",
        projectId: "proj-a",
        path: "a",
        detail: "b",
      });
    });
  });
});

describe("publishInputFromStored", () => {
  it("drops a script id on a stored clock row", () => {
    const payloads = replayPayloadsFromStored({
      id: "e1",
      type: EVENT_CLOCK_TICK,
      projectId: "proj-a",
      scriptId: "script-a",
      path: "ignored",
      detail: "ignored",
      createdAt: 1,
    });
    assert.equal(payloads.length, 1);
    const first = payloads[0];
    if (first === undefined) {
      assert.fail("expected a clock publish");
      return;
    }
    assert.equal(first.type, EVENT_CLOCK_TICK);
    assert.equal("path" in first, false);
  });

  it("refuses to replay a file change with no path", () => {
    const payloads = replayPayloadsFromStored({
      id: "e2",
      type: "file.changed",
      projectId: "proj-a",
      scriptId: "",
      path: "",
      detail: "add",
      createdAt: 1,
    });
    assert.equal(payloads.length, 0);
  });
});
