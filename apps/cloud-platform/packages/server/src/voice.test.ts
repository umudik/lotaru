import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setLotaruEventPublisher } from "./event-bus.js";
import { EVENT_VOICE_INTENT } from "./events.js";
import {
  listVoiceDecisions,
  listVoiceSegments,
  openVoiceDb,
  scanVoiceUtterance,
} from "./modules/voice.js";
import type { Identity } from "./modules/identity.js";

describe("scanVoiceUtterance", () => {
  it("emits voice.intent only when scanner says emit true", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-voice-"));
    const databasePath = join(dir, "app.sqlite");
    const db = openVoiceDb(databasePath);
    const emitted: string[] = [];
    setLotaruEventPublisher((partial) => {
      emitted.push(partial.type);
      return {
        id: `evt-${String(emitted.length)}`,
        type: partial.type,
        projectId: partial.projectId,
        scriptId: partial.scriptId,
        path: partial.path,
        detail: partial.detail,
        createdAt: Date.now(),
      };
    });
    const identity: Identity = {
      verifyAccessToken: async () => ({
        id: "u1",
        email: "a@b.c",
        name: "A",
        clientId: "c",
      }),
      userFrom: async () => ({
        id: "u1",
        email: "a@b.c",
        name: "A",
        clientId: "c",
      }),
      register: async () => undefined,
    };
    const options = {
      databasePath,
      identity,
      dataDir: dir,
      projectAccess: () => true,
      projectCwd: () => dir,
      runAgent: async (input: { prompt: string }) => {
        if (input.prompt.includes("Latest utterance:\nBunu task olarak yaz.")) {
          return '{"emit":true,"title":"Create task","summary":"Write it","reason":"clear ask"}';
        }
        return '{"emit":false,"title":"","summary":"","reason":"greeting"}';
      },
    };
    db.prepare(
      "INSERT INTO voice_segments (id, project_id, session_id, kind, text, started_at, ended_at, audio_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("seg-1", "proj-a", "sess", "final", "Selam.", 1, 2, "", Date.now());
    const first = await scanVoiceUtterance({
      options,
      db,
      projectId: "proj-a",
      segmentId: "seg-1",
      utterance: "Selam.",
    });
    assert.equal(first.emit, false);
    assert.equal(emitted.length, 0);
    db.prepare(
      "INSERT INTO voice_segments (id, project_id, session_id, kind, text, started_at, ended_at, audio_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("seg-2", "proj-a", "sess", "final", "Bunu task olarak yaz.", 3, 4, "", Date.now());
    const second = await scanVoiceUtterance({
      options,
      db,
      projectId: "proj-a",
      segmentId: "seg-2",
      utterance: "Bunu task olarak yaz.",
    });
    assert.equal(second.emit, true);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0], EVENT_VOICE_INTENT);
    assert.equal(listVoiceSegments(db, "proj-a", 10).length, 2);
    assert.equal(listVoiceDecisions(db, "proj-a", 10).length, 2);
  });
});
