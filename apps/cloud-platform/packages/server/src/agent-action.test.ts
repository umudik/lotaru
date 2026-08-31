import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentTaskFromOutput } from "./agent-action.js";

const EVENT = {
  eventType: "voice.rule.task",
  eventPath: "Ödeme ekranını düzelt",
  eventDetail: "Kart formu mobilde taşıyor",
};

describe("agentTaskFromOutput", () => {
  it("takes the first meaningful line as the title", () => {
    const draft = agentTaskFromOutput({
      output: "Fix the payment form on mobile\n\nThe card fields overflow below 380px.",
      fallbackTitle: "Task agent",
      ...EVENT,
    });
    assert.equal(draft.title, "Fix the payment form on mobile");
    assert.match(draft.description, /card fields overflow/);
  });

  it("strips markdown heading and list markers", () => {
    const draft = agentTaskFromOutput({
      output: "## Title: Fix the login redirect\nDetails follow.",
      fallbackTitle: "Task agent",
      ...EVENT,
    });
    assert.equal(draft.title, "Fix the login redirect");
  });

  it("falls back to the agent title for an empty reply", () => {
    const draft = agentTaskFromOutput({
      output: "   \n\n  ",
      fallbackTitle: "Task agent",
      ...EVENT,
    });
    assert.equal(draft.title, "Task agent");
  });

  it("records what triggered the run in the description", () => {
    const draft = agentTaskFromOutput({
      output: "Do the thing",
      fallbackTitle: "Task agent",
      ...EVENT,
    });
    assert.match(draft.description, /Triggered by voice\.rule\.task/);
    assert.match(draft.description, /Kart formu mobilde/);
  });

  it("truncates an overlong title", () => {
    const draft = agentTaskFromOutput({
      output: "x".repeat(400),
      fallbackTitle: "Task agent",
      ...EVENT,
    });
    assert.equal(draft.title.length, 200);
  });
});
