import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensureQcTitle,
  formatTaskInbox,
  pickActiveQcStageOpenIds,
  pickLatestQcEpic,
  qcTitleHasPrefix,
} from "./qc-tasks.js";

describe("qc titles", () => {
  it("prefixes only the qc agent slug", () => {
    assert.equal(ensureQcTitle("gate fail", "qc"), "QC gate fail");
    assert.equal(ensureQcTitle("QC 21 Eyl — fail", "qc"), "QC 21 Eyl — fail");
    assert.equal(ensureQcTitle("Do the work", "session"), "Do the work");
    assert.equal(qcTitleHasPrefix("QC a"), true);
    assert.equal(qcTitleHasPrefix("QCx"), false);
  });
});

describe("pickLatestQcEpic", () => {
  it("picks the newest QC epic and ignores children", () => {
    const latest = pickLatestQcEpic([
      { id: 2, parentId: 1, title: "QC child", createdAt: "2026-09-21T12:00:00.000Z" },
      { id: 1, parentId: null, title: "QC 09:00 — fail", createdAt: "2026-09-21T06:00:00.000Z" },
      { id: 3, parentId: null, title: "QC 21:00 — fail", createdAt: "2026-09-21T18:00:00.000Z" },
      { id: 4, parentId: null, title: "Fookie core", createdAt: "2026-09-22T00:00:00.000Z" },
    ]);
    assert.equal(latest === null, false);
    if (latest === null) {
      return;
    }
    assert.equal(latest.id, 3);
  });
});

describe("pickActiveQcStageOpenIds", () => {
  const stages = [
    { id: "do", position: 0 },
    { id: "incele", position: 1 },
    { id: "onay", position: 2 },
  ];

  function child(id: number, stageId: string, workStatus: string): {
    id: number;
    title: string;
    parentId: number;
    epicId: number;
    stageId: string;
    workStatus: string;
  } {
    return {
      id,
      title: stageId,
      parentId: 10,
      epicId: 10,
      stageId,
      workStatus,
    };
  }

  it("returns only the first incomplete stage", () => {
    const ids = pickActiveQcStageOpenIds(10, stages, [
      { id: 10, title: "QC", parentId: null, epicId: null, stageId: "do", workStatus: "todo" },
      child(11, "do", "todo"),
      child(12, "incele", "todo"),
      child(13, "onay", "todo"),
    ]);
    assert.deepEqual(ids, [11]);
  });

  it("advances to incele after gate is done", () => {
    const ids = pickActiveQcStageOpenIds(10, stages, [
      child(11, "do", "done"),
      child(12, "incele", "todo"),
      child(13, "onay", "todo"),
    ]);
    assert.deepEqual(ids, [12]);
  });

  it("does not skip to a later pile when the next stage is unspawned", () => {
    const ids = pickActiveQcStageOpenIds(10, stages, [
      child(11, "do", "done"),
      child(13, "onay", "todo"),
    ]);
    assert.deepEqual(ids, []);
  });
});

describe("formatTaskInbox", () => {
  it("lists open tasks with claim state", () => {
    const text = formatTaskInbox([
      {
        id: 9,
        title: "QC 21 Eyl — fail",
        parentId: null,
        stageId: "do",
        claimedBy: null,
        workStatus: "todo",
      },
      {
        id: 10,
        title: "Gate oku",
        parentId: 9,
        stageId: "do",
        claimedBy: "Lotaru",
        workStatus: "in_progress",
      },
    ]);
    assert.match(text, /OPEN TASKS/);
    assert.match(text, /#9 \[epic\/do\/todo\/unclaimed\]/);
    assert.match(text, /#10 \[subtask\/do\/in_progress\/claimed:Lotaru\]/);
  });
});
