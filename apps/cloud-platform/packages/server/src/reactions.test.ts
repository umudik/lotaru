import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EVENT_CLOCK_TICK, EVENT_FILE_CHANGED, EVENT_GITHUB_PR_OPENED } from "./events.js";
import {
  fillReactionTitle,
  reactionEventTypesForClient,
  reactionFingerprint,
  reactionFireFingerprint,
  reactionMatchesEvent,
  REACTION_CREATE_TASK,
  REACTION_PROPOSE_KNOWLEDGE,
  type KnowledgeReaction,
  type LotaruReaction,
  type TaskReaction,
} from "./reactions.js";

function prEvent(id: string): {
  id: string;
  type: string;
  projectId: string;
  scriptId: string;
  path: string;
  detail: string;
  createdAt: number;
} {
  return {
    id,
    type: EVENT_GITHUB_PR_OPENED,
    projectId: "proj-a",
    scriptId: "",
    path: "umudik/lotaru",
    detail: "12",
    createdAt: 1,
  };
}

function taskReaction(patch: {
  eventType?: string;
  repo?: string;
  enabled?: boolean;
  titleTemplate?: string;
}): TaskReaction {
  return Object.assign(
    {},
    {
      id: "r1",
      projectId: "proj-a",
      eventType: EVENT_GITHUB_PR_OPENED,
      repo: "umudik/lotaru",
      action: REACTION_CREATE_TASK,
      titleTemplate: "Review PR #{{detail}}",
      enabled: true,
      createdAt: 1,
    },
    patch,
  );
}

function knowledgeReaction(patch: {
  eventType?: string;
  repo?: string;
  enabled?: boolean;
  knowledgeItemId?: string;
  knowledgeOutputs?: ReadonlyArray<"document" | "diagram">;
}): KnowledgeReaction {
  return Object.assign(
    {},
    {
      id: "r1",
      projectId: "proj-a",
      eventType: EVENT_GITHUB_PR_OPENED,
      repo: "umudik/lotaru",
      action: REACTION_PROPOSE_KNOWLEDGE,
      knowledgeItemId: "k1",
      knowledgeOutputs: ["document", "diagram"],
      enabled: true,
      createdAt: 1,
    },
    patch,
  );
}

describe("reactionMatchesEvent", () => {
  it("creates a task intent when a matching GitHub PR opens", () => {
    const event = prEvent("e1");
    assert.equal(reactionMatchesEvent(taskReaction({}), event), true);
    assert.equal(reactionMatchesEvent(taskReaction({ repo: "other/repo" }), event), false);
    assert.equal(reactionMatchesEvent(taskReaction({ enabled: false }), event), false);
    assert.equal(
      reactionMatchesEvent(taskReaction({}), Object.assign({}, event, { type: EVENT_FILE_CHANGED })),
      false,
    );
  });

  it("treats leftover schedule.fired reactions as clock.tick", () => {
    const tick = {
      id: "e-clock",
      type: EVENT_CLOCK_TICK,
      projectId: "proj-a",
      scriptId: "",
      path: "",
      detail: "",
      createdAt: 1,
    };
    assert.equal(reactionMatchesEvent(taskReaction({ eventType: "schedule.fired", repo: "" }), tick), true);
    assert.equal(reactionMatchesEvent(taskReaction({ eventType: EVENT_CLOCK_TICK, repo: "" }), tick), true);
  });

  it("matches knowledge automation without creating a task path", () => {
    const event = prEvent("e1");
    assert.equal(reactionMatchesEvent(knowledgeReaction({}), event), true);
    assert.equal(
      reactionMatchesEvent(knowledgeReaction({ knowledgeItemId: "" }), event),
      false,
    );
    assert.equal(
      reactionMatchesEvent(knowledgeReaction({ knowledgeOutputs: [] }), event),
      false,
    );
  });
});

describe("fillReactionTitle", () => {
  it("fills the PR number into the task purpose", () => {
    assert.equal(fillReactionTitle("Review PR #{{detail}}", prEvent("e1")), "Review PR #12");
  });
});

describe("reactionFingerprint", () => {
  it("is stable per reaction and PR", () => {
    assert.equal(
      reactionFingerprint("r1", prEvent("e1")),
      "r1:github.pull_request.opened:umudik/lotaru:12",
    );
  });
});

describe("reactionFireFingerprint", () => {
  it("keeps task fingerprints stable per PR and knowledge fingerprints unique per event", () => {
    const first = prEvent("e1");
    const second = prEvent("e2");
    const task: LotaruReaction = taskReaction({});
    assert.equal(reactionFireFingerprint(task, first), reactionFingerprint(task.id, first));
    assert.equal(reactionFireFingerprint(task, first), reactionFireFingerprint(task, second));
    const knowledge = knowledgeReaction({});
    assert.equal(reactionFireFingerprint(knowledge, first), "r1:e1");
    assert.equal(reactionFireFingerprint(knowledge, second), "r1:e2");
  });
});

describe("reactionEventTypesForClient", () => {
  it("hides GitHub events until a token and remote exist", () => {
    const hidden = reactionEventTypesForClient(false);
    let hasGithub = false;
    for (const eventType of hidden) {
      if (eventType.startsWith("github.")) {
        hasGithub = true;
      }
    }
    assert.equal(hasGithub, false);
    assert.equal(hidden.includes(EVENT_FILE_CHANGED), true);
    assert.equal(hidden.includes(EVENT_CLOCK_TICK), true);
    const shown = reactionEventTypesForClient(true);
    assert.equal(shown.includes(EVENT_GITHUB_PR_OPENED), true);
  });
});
