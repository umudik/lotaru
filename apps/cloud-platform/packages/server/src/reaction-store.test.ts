import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EVENT_FILE_CHANGED, EVENT_GITHUB_PR_OPENED } from "./events.js";
import {
  claimReactionFire,
  ensureReactionSchema,
  insertReaction,
  parseReactionInput,
} from "./reaction-store.js";

describe("parseReactionInput", () => {
  it("accepts create_task reactions and rejects knowledge automation", () => {
    const parsed = parseReactionInput({
      action: "create_task",
      eventType: EVENT_GITHUB_PR_OPENED,
      repo: "umudik/lotaru",
      titleTemplate: "Review PR #{{detail}}",
      enabled: true,
    });
    assert.equal(parsed.eventType, EVENT_GITHUB_PR_OPENED);
    assert.equal(parsed.repo, "umudik/lotaru");
    assert.equal(parsed.action, "create_task");
    assert.throws(() => {
      parseReactionInput({
        action: "create_task",
        eventType: "invented.event",
        repo: "umudik/lotaru",
        titleTemplate: "x",
        enabled: true,
      });
    });
    assert.throws(() => {
      parseReactionInput({
        action: "create_task",
        eventType: EVENT_GITHUB_PR_OPENED,
        repo: "lotaru",
        titleTemplate: "x",
        enabled: true,
      });
    });
    const emptyRepo = parseReactionInput({
      action: "create_task",
      eventType: EVENT_GITHUB_PR_OPENED,
      repo: "",
      titleTemplate: "Review PR #{{detail}}",
      enabled: true,
    });
    assert.equal(emptyRepo.repo, "");
    const fileReaction = parseReactionInput({
      action: "create_task",
      eventType: EVENT_FILE_CHANGED,
      repo: "",
      titleTemplate: "File changed {{path}}",
      enabled: true,
    });
    assert.equal(fileReaction.eventType, EVENT_FILE_CHANGED);
    assert.equal(fileReaction.action, "create_task");
    assert.throws(() => {
      parseReactionInput({
        action: "propose_knowledge",
        eventType: EVENT_FILE_CHANGED,
        repo: "",
        enabled: true,
        knowledgeItemId: "k1",
        knowledgeOutputs: ["document", "diagram"],
      });
    });
    const stripped = parseReactionInput({
      action: "create_task",
      eventType: EVENT_FILE_CHANGED,
      repo: "",
      titleTemplate: "Handle {{path}}",
      enabled: true,
      knowledgeItemId: "k1",
      knowledgeOutputs: ["document"],
    });
    assert.equal("knowledgeItemId" in stripped, false);
  });
});

describe("claimReactionFire", () => {
  it("fires once per fingerprint", () => {
    const db = new Database(":memory:");
    ensureReactionSchema(db);
    const reaction = insertReaction(
      db,
      "proj-a",
      parseReactionInput({
        action: "create_task",
        eventType: EVENT_GITHUB_PR_OPENED,
        repo: "umudik/lotaru",
        titleTemplate: "Review PR #{{detail}}",
        enabled: true,
      }),
    );
    const fingerprint = `${reaction.id}:${EVENT_GITHUB_PR_OPENED}:umudik/lotaru:12`;
    assert.equal(claimReactionFire(db, fingerprint, reaction.id), true);
    assert.equal(claimReactionFire(db, fingerprint, reaction.id), false);
    db.close();
  });
});
