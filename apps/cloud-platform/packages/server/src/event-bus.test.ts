import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearLotaruEventPublisher,
  publishLotaruEvent,
  setLotaruEventPublisher,
} from "./event-bus.js";
import { storedEnvelopeFromPublish } from "./event-publish.js";
import { EVENT_CLOCK_TICK } from "./events.js";

describe("publishLotaruEvent", () => {
  it("throws when no publisher is registered", () => {
    clearLotaruEventPublisher();
    assert.throws(() => {
      publishLotaruEvent({ type: EVENT_CLOCK_TICK, projectId: "proj-a" }, "live");
    }, /not registered/);
  });

  it("hands the typed publish input to the publisher", () => {
    clearLotaruEventPublisher();
    setLotaruEventPublisher((input, kind, agentChain) => {
      assert.equal(kind, "live");
      assert.equal(agentChain.length, 0);
      assert.equal(input.type, EVENT_CLOCK_TICK);
      assert.equal(input.projectId, "proj-a");
      assert.equal("scriptId" in input, false);
      const stored = storedEnvelopeFromPublish(input);
      return {
        id: "e1",
        type: stored.type,
        projectId: stored.projectId,
        scriptId: stored.scriptId,
        path: stored.path,
        detail: stored.detail,
        createdAt: 1,
      };
    });
    const event = publishLotaruEvent({ type: EVENT_CLOCK_TICK, projectId: "proj-a" }, "live");
    assert.equal(event.id, "e1");
    clearLotaruEventPublisher();
  });
});
