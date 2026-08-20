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
    const listed = listProjectEvents(db, { projectId: "proj-a", limit: 50, type: "", cursor: "" });
    assert.equal(listed.events.length, 2);
    const newest = listed.events[0];
    const older = listed.events[1];
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

  it("filters by catalog type", () => {
    const db = new Database(":memory:");
    ensureEventLogSchema(db);
    recordEvent(db, {
      id: "tick",
      type: "clock.tick",
      projectId: "proj-a",
      scriptId: "",
      path: "",
      detail: "",
      createdAt: 10,
    });
    recordEvent(db, {
      id: "file",
      type: "file.changed",
      projectId: "proj-a",
      scriptId: "",
      path: "src/a.ts",
      detail: "change",
      createdAt: 20,
    });
    const files = listProjectEvents(db, {
      projectId: "proj-a",
      limit: 50,
      type: "file.changed",
      cursor: "",
    });
    assert.equal(files.events.length, 1);
    assert.equal(files.events[0]?.id, "file");
    assert.equal(files.next.length, 0);
    db.close();
  });

  it("pages with a created_at,id cursor", () => {
    const db = new Database(":memory:");
    ensureEventLogSchema(db);
    recordEvent(db, {
      id: "a",
      type: "file.changed",
      projectId: "proj-a",
      scriptId: "",
      path: "a.ts",
      detail: "",
      createdAt: 10,
    });
    recordEvent(db, {
      id: "b",
      type: "file.changed",
      projectId: "proj-a",
      scriptId: "",
      path: "b.ts",
      detail: "",
      createdAt: 20,
    });
    recordEvent(db, {
      id: "c",
      type: "file.changed",
      projectId: "proj-a",
      scriptId: "",
      path: "c.ts",
      detail: "",
      createdAt: 30,
    });
    const first = listProjectEvents(db, {
      projectId: "proj-a",
      limit: 2,
      type: "",
      cursor: "",
    });
    assert.equal(first.events.length, 2);
    assert.equal(first.events[0]?.id, "c");
    assert.equal(first.events[1]?.id, "b");
    assert.equal(first.next.length, 1);
    const cursor = first.next[0];
    if (cursor === undefined) {
      assert.fail("expected a next cursor");
      return;
    }
    const second = listProjectEvents(db, {
      projectId: "proj-a",
      limit: 2,
      type: "",
      cursor,
    });
    assert.equal(second.events.length, 1);
    assert.equal(second.events[0]?.id, "a");
    assert.equal(second.next.length, 0);
    db.close();
  });

  it("rejects a broken cursor", () => {
    const db = new Database(":memory:");
    ensureEventLogSchema(db);
    assert.throws(
      () =>
        listProjectEvents(db, {
          projectId: "proj-a",
          limit: 2,
          type: "",
          cursor: "not-a-cursor",
        }),
      { message: "Invalid event cursor" },
    );
    db.close();
  });
});
