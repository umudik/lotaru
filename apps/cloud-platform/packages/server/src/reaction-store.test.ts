import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EVENT_FILE_CHANGED, EVENT_GITHUB_PR_OPENED } from "./events.js";
import {
  claimReactionFire,
  ensureReactionSchema,
  insertReaction,
  listReactions,
  parseReactionInput,
} from "./reaction-store.js";

describe("parseReactionInput", () => {
  it("accepts a GitHub owner/repo reaction and rejects unknown types", () => {
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
    assert.equal("knowledgeItemId" in parsed, false);
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
    const knowledge = parseReactionInput({
      action: "propose_knowledge",
      eventType: EVENT_FILE_CHANGED,
      repo: "",
      enabled: true,
      knowledgeItemId: "k1",
      knowledgeOutputs: ["document", "diagram"],
    });
    assert.equal(knowledge.action, "propose_knowledge");
    if (knowledge.action === "propose_knowledge") {
      assert.equal(knowledge.knowledgeItemId, "k1");
      assert.deepEqual(knowledge.knowledgeOutputs, ["document", "diagram"]);
    }
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
    assert.throws(() => {
      parseReactionInput({
        action: "propose_knowledge",
        eventType: EVENT_FILE_CHANGED,
        repo: "",
        enabled: true,
        knowledgeItemId: "",
        knowledgeOutputs: ["document"],
      });
    });
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

  it("stores knowledge automation fields", () => {
    const db = new Database(":memory:");
    ensureReactionSchema(db);
    const stored = insertReaction(
      db,
      "proj-a",
      parseReactionInput({
        action: "propose_knowledge",
        eventType: EVENT_FILE_CHANGED,
        repo: "",
        enabled: true,
        knowledgeItemId: "k1",
        knowledgeOutputs: ["diagram"],
      }),
    );
    assert.equal(stored.action, "propose_knowledge");
    if (stored.action === "propose_knowledge") {
      assert.equal(stored.knowledgeItemId, "k1");
    }
    const listed = listReactions(db, "proj-a");
    assert.equal(listed.length, 1);
    for (const first of listed) {
      if (first.action === "propose_knowledge") {
        assert.deepEqual(first.knowledgeOutputs, ["diagram"]);
      }
    }
    db.close();
  });
});
