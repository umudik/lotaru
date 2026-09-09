import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { createIdentity } from "./modules/identity.js";
import { registerSpeakModule } from "./modules/speak.js";
import { enqueueSpeakUtterance, failSpeakUtterance, getSpeakUtterance, listSpeakPlayable, listSpeakUtterances, markSpeakPlayed } from "./speak-store.js";

const PROJECT_ID = "proj-speak";

async function startSpeak(access = true, synthesize?: (text: string, language: string) => Promise<Buffer>) {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-speak-"));
  const databasePath = join(dir, "app.sqlite");
  const app = Fastify({ logger: false });
  const identity = await createIdentity({
    publicUrl: "http://127.0.0.1:4317",
    dataDir: dir,
  });
  let synth = synthesize;
  if (synth === undefined) {
    synth = async (text) => {
      return Buffer.from(`ID3${text}`, "utf8");
    };
  }
  await registerSpeakModule(app, {
    databasePath,
    identity,
    projectAccess: () => access,
    synthesize: synth,
  });
  return { app, databasePath };
}

describe("speak store", () => {
  it("queues clipped text and lists newest first", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-speak-store-"));
    const databasePath = join(dir, "app.sqlite");
    const first = enqueueSpeakUtterance(databasePath, {
      projectId: PROJECT_ID,
      text: "  hello speak  ",
      source: "ui",
      createdBy: "lotaru-local",
    });
    assert.equal(first.text, "hello speak");
    assert.equal(first.status, "queued");
    enqueueSpeakUtterance(databasePath, {
      projectId: PROJECT_ID,
      text: "second",
      source: "mcp",
      createdBy: "lotaru-local",
    });
    const listed = listSpeakUtterances(databasePath, PROJECT_ID, undefined);
    assert.equal(listed.length, 2);
    assert.equal(listed[0]?.text, "second");
    assert.equal(listed[1]?.text, "hello speak");
  });

  it("refuses a fifty-first unplayed utterance", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-speak-full-"));
    const databasePath = join(dir, "app.sqlite");
    let index = 0;
    while (index < 50) {
      enqueueSpeakUtterance(databasePath, {
        projectId: PROJECT_ID,
        text: `queued ${String(index)}`,
        source: "ui",
        createdBy: "lotaru-local",
      });
      index += 1;
    }
    assert.throws(
      () =>
        enqueueSpeakUtterance(databasePath, {
          projectId: PROJECT_ID,
          text: "overflow",
          source: "ui",
          createdBy: "lotaru-local",
        }),
      /Speak queue is full/,
    );
    const listed = listSpeakUtterances(databasePath, PROJECT_ID, undefined);
    assert.equal(listed.length, 50);
  });

  it("keeps unplayed rows while pruning old played history", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-speak-prune-played-"));
    const databasePath = join(dir, "app.sqlite");
    const kept = enqueueSpeakUtterance(databasePath, {
      projectId: PROJECT_ID,
      text: "keep-me",
      source: "mcp",
      createdBy: "lotaru-local",
    });
    let index = 0;
    while (index < 55) {
      const row = enqueueSpeakUtterance(databasePath, {
        projectId: PROJECT_ID,
        text: `played ${String(index)}`,
        source: "ui",
        createdBy: "lotaru-local",
      });
      markSpeakPlayed(databasePath, row.id);
      index += 1;
    }
    const stillQueued = getSpeakUtterance(databasePath, kept.id);
    assert.equal(stillQueued?.text, "keep-me");
    assert.equal(stillQueued?.status, "queued");
    const playable = listSpeakPlayable(databasePath, PROJECT_ID);
    assert.equal(playable.length, 1);
    assert.equal(playable[0]?.text, "keep-me");
    const listed = listSpeakUtterances(databasePath, PROJECT_ID, undefined);
    assert.equal(listed.length, 51);
    assert.equal(listed[0]?.text, "keep-me");
    assert.equal(listed[1]?.text, "played 54");
  });

  it("refuses to mark a failed utterance as played", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-speak-failed-played-"));
    const databasePath = join(dir, "app.sqlite");
    const row = enqueueSpeakUtterance(databasePath, {
      projectId: PROJECT_ID,
      text: "will fail",
      source: "ui",
      createdBy: "lotaru-local",
    });
    failSpeakUtterance(databasePath, row.id, "edge down");
    assert.throws(() => markSpeakPlayed(databasePath, row.id), /Speak already failed/);
    const stored = getSpeakUtterance(databasePath, row.id);
    assert.equal(stored?.status, "failed");
    const again = markSpeakPlayed(
      databasePath,
      enqueueSpeakUtterance(databasePath, {
        projectId: PROJECT_ID,
        text: "ok",
        source: "ui",
        createdBy: "lotaru-local",
      }).id,
    );
    assert.equal(again.status, "played");
    assert.equal(markSpeakPlayed(databasePath, again.id).status, "played");
  });

  it("refuses blank text", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-speak-blank-"));
    const databasePath = join(dir, "app.sqlite");
    assert.throws(
      () =>
        enqueueSpeakUtterance(databasePath, {
          projectId: PROJECT_ID,
          text: "   ",
          source: "ui",
          createdBy: "lotaru-local",
        }),
      /Nothing to read/,
    );
    const missing = getSpeakUtterance(databasePath, "missing");
    assert.equal(missing, undefined);
  });
});

describe("speak http", () => {
  it("creates, synthesizes, and marks played", async (t) => {
    const { app } = await startSpeak();
    t.after(async () => {
      await app.close();
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/speak",
      payload: { projectId: PROJECT_ID, text: "Read this", source: "ui" },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().status, "queued");
    assert.equal(created.json().text, "Read this");
    const utteranceId = created.json().id;
    const one = await app.inject({
      method: "GET",
      url: `/api/speak/${utteranceId}`,
    });
    assert.equal(one.statusCode, 200);
    assert.equal(one.json().text, "Read this");
    const audio = await app.inject({
      method: "GET",
      url: `/api/speak/${utteranceId}/audio`,
    });
    assert.equal(audio.statusCode, 200);
    assert.match(String(audio.headers["content-type"]), /audio\/mpeg/);
    assert.equal(audio.rawPayload.includes("Read this"), true);
    assert.match(String(audio.headers["cache-control"]), /private/);
    const cached = await app.inject({
      method: "GET",
      url: `/api/speak/${utteranceId}/audio`,
    });
    assert.equal(cached.statusCode, 200);
    const played = await app.inject({
      method: "POST",
      url: `/api/speak/${utteranceId}/played`,
    });
    assert.equal(played.statusCode, 200);
    assert.equal(played.json().status, "played");
    const playable = await app.inject({
      method: "GET",
      url: `/api/speak?projectId=${PROJECT_ID}&playable=1`,
    });
    assert.equal(playable.statusCode, 200);
    assert.equal(playable.json().utterances.length, 0);
  });

  it("hides speak when the project is not visible", async (t) => {
    const { app } = await startSpeak(false);
    t.after(async () => {
      await app.close();
    });
    const listed = await app.inject({
      method: "GET",
      url: `/api/speak?projectId=${PROJECT_ID}`,
    });
    assert.equal(listed.statusCode, 404);
    const created = await app.inject({
      method: "POST",
      url: "/api/speak",
      payload: { projectId: PROJECT_ID, text: "nope" },
    });
    assert.equal(created.statusCode, 404);
  });

  it("rejects empty create bodies", async (t) => {
    const { app } = await startSpeak();
    t.after(async () => {
      await app.close();
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/speak",
      payload: { projectId: PROJECT_ID, text: "  " },
    });
    assert.equal(created.statusCode, 400);
  });

  it("synthesizes once when audio is requested twice at once", async (t) => {
    let calls = 0;
    const { app } = await startSpeak(true, async (text) => {
      calls += 1;
      await new Promise((resolve) => {
        setTimeout(resolve, 40);
      });
      return Buffer.from(`ID3${text}`, "utf8");
    });
    t.after(async () => {
      await app.close();
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/speak",
      payload: { projectId: PROJECT_ID, text: "once" },
    });
    assert.equal(created.statusCode, 201);
    const utteranceId = created.json().id;
    const first = app.inject({
      method: "GET",
      url: `/api/speak/${utteranceId}/audio`,
    });
    const second = app.inject({
      method: "GET",
      url: `/api/speak/${utteranceId}/audio`,
    });
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left.statusCode, 200);
    assert.equal(right.statusCode, 200);
    assert.equal(calls, 1);
  });

  it("returns 409 when the unplayed queue is full", async (t) => {
    const { app } = await startSpeak();
    t.after(async () => {
      await app.close();
    });
    let index = 0;
    while (index < 50) {
      const created = await app.inject({
        method: "POST",
        url: "/api/speak",
        payload: { projectId: PROJECT_ID, text: `slot ${String(index)}`, source: "ui" },
      });
      assert.equal(created.statusCode, 201);
      index += 1;
    }
    const overflow = await app.inject({
      method: "POST",
      url: "/api/speak",
      payload: { projectId: PROJECT_ID, text: "too many", source: "ui" },
    });
    assert.equal(overflow.statusCode, 409);
    assert.equal(overflow.json().error, "Speak queue is full");
  });

  it("retries synthesis after a failed audio request", async (t) => {
    let calls = 0;
    const { app, databasePath } = await startSpeak(true, async (text) => {
      calls += 1;
      if (calls === 1) {
        throw new Error("edge down");
      }
      return Buffer.from(`ID3${text}`, "utf8");
    });
    t.after(async () => {
      await app.close();
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/speak",
      payload: { projectId: PROJECT_ID, text: "retry me", source: "ui" },
    });
    assert.equal(created.statusCode, 201);
    const utteranceId = created.json().id;
    const first = await app.inject({
      method: "GET",
      url: `/api/speak/${utteranceId}/audio`,
    });
    assert.equal(first.statusCode, 502);
    assert.equal(getSpeakUtterance(databasePath, utteranceId)?.status, "failed");
    const marked = await app.inject({
      method: "POST",
      url: `/api/speak/${utteranceId}/played`,
    });
    assert.equal(marked.statusCode, 409);
    const second = await app.inject({
      method: "GET",
      url: `/api/speak/${utteranceId}/audio`,
    });
    assert.equal(second.statusCode, 200);
    assert.equal(getSpeakUtterance(databasePath, utteranceId)?.status, "ready");
    assert.equal(calls, 2);
  });

  it("rejects listing with both playable and status", async (t) => {
    const { app } = await startSpeak();
    t.after(async () => {
      await app.close();
    });
    const listed = await app.inject({
      method: "GET",
      url: `/api/speak?projectId=${PROJECT_ID}&playable=1&status=queued`,
    });
    assert.equal(listed.statusCode, 400);
    assert.equal(listed.json().error, "invalid query");
  });
});
