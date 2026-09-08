import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyIngestAlarm, ingestAlarmFrom, ingestAlarmLogDetail, ingestAlarmLogEvents } from "./ingest-alarm.js";

describe("ingest alarm", () => {
  it("is quiet when polls are healthy and the tunnel is live or disabled", () => {
    const live = ingestAlarmFrom({
      polls: [{ connector: "github", lastError: "", lagged: false }],
      tunnelEnabled: true,
      tunnelState: "up",
    });
    assert.deepEqual(live, emptyIngestAlarm());
    const off = ingestAlarmFrom({
      polls: [],
      tunnelEnabled: false,
      tunnelState: "off",
    });
    assert.equal(off.kind, "ok");
  });

  it("bombards poll errors before lag, and tunnel-down before a quiet backlog", () => {
    const failed = ingestAlarmFrom({
      polls: [
        { connector: "github", lastError: "GitHub pulls 502", lagged: true },
        { connector: "rss", lastError: "", lagged: true },
      ],
      tunnelEnabled: true,
      tunnelState: "up",
    });
    assert.equal(failed.kind, "poll_error");
    assert.equal(failed.detail, "GitHub pulls 502");
    assert.deepEqual(failed.connectors, ["github"]);
    const down = ingestAlarmFrom({
      polls: [{ connector: "github", lastError: "", lagged: false }],
      tunnelEnabled: true,
      tunnelState: "error",
    });
    assert.equal(down.kind, "tunnel_down");
    const behind = ingestAlarmFrom({
      polls: [
        { connector: "github", lastError: "", lagged: true },
        { connector: "github", lastError: "", lagged: true },
        { connector: "notion", lastError: "", lagged: true },
      ],
      tunnelEnabled: true,
      tunnelState: "up",
    });
    assert.equal(behind.kind, "behind");
    assert.deepEqual(behind.connectors, ["github", "notion"]);
  });

  it("does not bombard while the tunnel is starting", () => {
    const starting = ingestAlarmFrom({
      polls: [],
      tunnelEnabled: true,
      tunnelState: "starting",
    });
    assert.equal(starting.kind, "ok");
  });

  it("writes a log row only when the alarm kind changes", () => {
    const behind = ingestAlarmFrom({
      polls: [{ connector: "github", lastError: "", lagged: true }],
      tunnelEnabled: true,
      tunnelState: "up",
    });
    const quiet = ingestAlarmLogEvents("ok", emptyIngestAlarm(), ["proj-a"]);
    assert.deepEqual(quiet, []);
    const first = ingestAlarmLogEvents("ok", behind, ["proj-a", "proj-b"]);
    assert.equal(first.length, 2);
    assert.equal(first[0]?.path, "behind");
    assert.equal(first[0]?.detail.includes("github"), true);
    const same = ingestAlarmLogEvents("behind", behind, ["proj-a"]);
    assert.deepEqual(same, []);
    const recovered = ingestAlarmLogEvents("behind", emptyIngestAlarm(), ["proj-a"]);
    assert.equal(recovered[0]?.path, "ok");
    assert.equal(ingestAlarmLogDetail(emptyIngestAlarm()), "Catch-up is healthy.");
  });
});
