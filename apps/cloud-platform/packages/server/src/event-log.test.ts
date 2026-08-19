import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensureEventLogSchema, eventsById, listProjectEvents, recordEvent } from "./event-log.js";

describe("event log", () => {
  it("stores events per project and lists newest first", () => {
    const db = new Database(":memory:");
    ensureEventLogSchema(db);
    recordEvent(db, {
      id: "e1",
      type: "clock.tick",
      projectId: "proj-a",
      scriptId: "",
      path: "",
      detail: "",
      createdAt: 10,
    });
    recordEvent(db, {
      id: "e2",
      type: "file.changed",
      projectId: "proj-a",
      scriptId: "",
      path: "src/a.ts",
      detail: "change",
      createdAt: 20,
    });
    recordEvent(db, {
      id: "e3",
      type: "clock.tick",
      projectId: "proj-b",
      scriptId: "",
      path: "",
      detail: "",
      createdAt: 30,
    });
    const listed = listProjectEvents(db, "proj-a", 50);
    assert.equal(listed.length, 2);
    const newest = listed[0];
    const older = listed[1];
    if (newest === undefined || older === undefined) {
      assert.fail("expected two stored events");
      return;
    }
    assert.equal(newest.id, "e2");
    assert.equal(older.id, "e1");
    db.close();
  });

  it("loads one event by id inside its project", () => {
    const db = new Database(":memory:");
    ensureEventLogSchema(db);
    recordEvent(db, {
      id: "e9",
      type: "github.pull_request.opened",
      projectId: "proj-a",
      scriptId: "",
      path: "umudik/lotaru",
      detail: "12",
      createdAt: 40,
    });
    const found = eventsById(db, "proj-a", "e9");
    assert.equal(found.length, 1);
    const first = found[0];
    if (first === undefined) {
      assert.fail("expected the stored event");
      return;
    }
    assert.equal(first.detail, "12");
    const otherProject = eventsById(db, "proj-b", "e9");
    assert.equal(otherProject.length, 0);
    const missing = eventsById(db, "proj-a", "nope");
    assert.equal(missing.length, 0);
    db.close();
  });
});
