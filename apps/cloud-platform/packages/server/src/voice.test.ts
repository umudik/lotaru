import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { openVoiceDb, pageVoiceSegments } from "./modules/voice.js";

describe("pageVoiceSegments", () => {
  it("returns opaque next cursor and walks pages", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-voice-page-"));
    const db = openVoiceDb(join(dir, "app.sqlite"));
    const insert = db.prepare(
      "INSERT INTO voice_segments (id, project_id, session_id, kind, text, started_at, ended_at, audio_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (let i = 0; i < 5; i += 1) {
      insert.run(
        `seg-${String(i)}`,
        "proj-a",
        "sess",
        "final",
        `line ${String(i)}`,
        i,
        i + 1,
        "",
        1000 + i,
      );
    }
    const first = pageVoiceSegments(db, 2, "");
    assert.equal(first.segments.length, 2);
    assert.equal(first.next.length, 1);
    assert.equal(first.segments[0]?.text, "line 4");
    const cursor = first.next[0];
    assert.equal(typeof cursor, "string");
    if (cursor === undefined) {
      assert.fail("missing cursor");
    }
    const second = pageVoiceSegments(db, 2, cursor);
    assert.equal(second.segments.length, 2);
    assert.equal(second.segments[0]?.text, "line 2");
    assert.equal(second.next.length, 1);
  });
});
