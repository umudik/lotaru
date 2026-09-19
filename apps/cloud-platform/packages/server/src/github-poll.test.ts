import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVENT_GITHUB_PR_OPENED } from "./events.js";
import { pollGithubOnce, type GithubHttpGet } from "./github-poll.js";
import { ensureGithubSchema, markGithubRepoPrimed, saveGithubToken } from "./github-store.js";
import { ensurePollSchema, loadPollCursor } from "./poll-store.js";

function stubGithubHttp(pulls: unknown[]): GithubHttpGet {
  return async (url) => {
    if (url.includes("/pulls")) {
      return { ok: true, status: 200, body: pulls };
    }
    if (url.includes("/issues")) {
      return { ok: true, status: 200, body: [] };
    }
    if (url.includes("/notifications")) {
      return { ok: true, status: 200, body: [] };
    }
    return { ok: false, status: 404, body: [] };
  };
}

describe("github poll catch-up", () => {
  it("primes without emitting then emits a new PR in the overlap window", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-ghpoll-"));
    const db = new Database(join(dir, "app.sqlite"));
    ensureGithubSchema(db);
    ensurePollSchema(db);
    saveGithubToken(db, "gho_test_token");
    const emitted: string[] = [];
    const now = Date.parse("2026-09-08T00:02:00.000Z");
    const pull = {
      number: 41,
      state: "open",
      updated_at: "2026-09-08T00:01:00.000Z",
      merged_at: null,
      title: "Catch up",
    };
    await pollGithubOnce(
      db,
      [{ repo: "umudik/lotaru", projectId: "proj-1" }],
      (event) => {
        emitted.push(event.type);
      },
      { httpGet: stubGithubHttp([pull]), nowMs: now },
    );
    assert.deepEqual(emitted, []);
    markGithubRepoPrimed(db, "umudik/lotaru");
    const later = Date.parse("2026-09-08T00:03:00.000Z");
    const newer = {
      number: 42,
      state: "open",
      updated_at: "2026-09-08T00:02:30.000Z",
      merged_at: null,
      title: "New work",
    };
    await pollGithubOnce(
      db,
      [{ repo: "umudik/lotaru", projectId: "proj-1" }],
      (event) => {
        emitted.push(`${event.type}:${event.detail}`);
      },
      { httpGet: stubGithubHttp([newer, pull]), nowMs: later },
    );
    assert.equal(emitted.includes(`${EVENT_GITHUB_PR_OPENED}:42`), true);
    assert.equal(emitted.includes(`${EVENT_GITHUB_PR_OPENED}:41`), false);
    db.close();
  });

  it("keeps the last success cursor when GitHub returns an error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-ghpoll-err-"));
    const db = new Database(join(dir, "app.sqlite"));
    ensureGithubSchema(db);
    ensurePollSchema(db);
    saveGithubToken(db, "gho_test_token");
    const now = Date.parse("2026-09-08T00:10:00.000Z");
    await pollGithubOnce(
      db,
      [{ repo: "umudik/lotaru", projectId: "proj-1" }],
      () => {
        return;
      },
      { httpGet: stubGithubHttp([]), nowMs: now },
    );
    const ok = loadPollCursor(db, "github", "account");
    assert.equal(ok.lastSuccessAt, now);
    assert.equal(ok.lastError, "");
    const failGet: GithubHttpGet = async () => {
      return { ok: false, status: 502, body: [] };
    };
    const later = Date.parse("2026-09-08T00:12:00.000Z");
    await pollGithubOnce(
      db,
      [{ repo: "umudik/lotaru", projectId: "proj-1" }],
      () => {
        return;
      },
      { httpGet: failGet, nowMs: later },
    );
    const failed = loadPollCursor(db, "github", "account");
    assert.equal(failed.lastSuccessAt, now);
    assert.equal(failed.lastError.includes("502"), true);
    db.close();
  });

  it("drains a lagged pull list on the next tick instead of skipping it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-ghpoll-drain-"));
    const db = new Database(join(dir, "app.sqlite"));
    ensureGithubSchema(db);
    ensurePollSchema(db);
    saveGithubToken(db, "gho_test_token");
    const pullsByPage: Record<number, unknown[]> = {
      1: [
        {
          number: 50,
          state: "open",
          updated_at: "2026-09-08T00:21:00.000Z",
          merged_at: null,
          title: "Newest",
        },
      ],
      2: [
        {
          number: 49,
          state: "open",
          updated_at: "2026-09-08T00:20:30.000Z",
          merged_at: null,
          title: "Older in window",
        },
      ],
    };
    const httpGet: GithubHttpGet = async (url) => {
      if (url.includes("/issues") || url.includes("/notifications")) {
        return { ok: true, status: 200, body: [] };
      }
      if (url.includes("/pulls") !== true) {
        return { ok: false, status: 404, body: [] };
      }
      const hit = /[?&]page=(\d+)/.exec(url);
      let page = 1;
      if (hit !== null && hit[1] !== undefined) {
        page = Number.parseInt(hit[1], 10);
      }
      const rows = pullsByPage[page];
      if (rows === undefined) {
        return { ok: true, status: 200, body: [] };
      }
      return { ok: true, status: 200, body: rows };
    };
    const now = Date.parse("2026-09-08T00:22:00.000Z");
    await pollGithubOnce(
      db,
      [{ repo: "umudik/lotaru", projectId: "proj-1" }],
      () => {
        return;
      },
      { httpGet, nowMs: now, maxPages: 1, pageSize: 1, maxWalkPages: 4 },
    );
    const first = loadPollCursor(db, "github", "account");
    assert.equal(first.lagged, true);
    assert.equal(first.lastSuccessAt, now);
    markGithubRepoPrimed(db, "umudik/lotaru");
    const emitted: string[] = [];
    const later = Date.parse("2026-09-08T00:22:30.000Z");
    await pollGithubOnce(
      db,
      [{ repo: "umudik/lotaru", projectId: "proj-1" }],
      (event) => {
        emitted.push(`${event.type}:${event.detail}`);
      },
      { httpGet, nowMs: later, maxPages: 1, pageSize: 1, maxWalkPages: 4 },
    );
    assert.equal(emitted.includes(`${EVENT_GITHUB_PR_OPENED}:49`), true);
    assert.equal(emitted.includes(`${EVENT_GITHUB_PR_OPENED}:50`), false);
    const second = loadPollCursor(db, "github", "account");
    assert.equal(second.lagged, true);
    assert.equal(second.lastSuccessAt, now);
    const evenLater = Date.parse("2026-09-08T00:23:00.000Z");
    await pollGithubOnce(
      db,
      [{ repo: "umudik/lotaru", projectId: "proj-1" }],
      (event) => {
        emitted.push(`${event.type}:${event.detail}`);
      },
      { httpGet, nowMs: evenLater, maxPages: 1, pageSize: 1, maxWalkPages: 4 },
    );
    const third = loadPollCursor(db, "github", "account");
    assert.equal(third.lagged, false);
    assert.equal(third.lastSuccessAt, evenLater);
    db.close();
  });

  it("polls with an explicit token when no settings PAT is stored", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-ghpoll-oauth-"));
    const db = new Database(join(dir, "app.sqlite"));
    ensureGithubSchema(db);
    ensurePollSchema(db);
    const seen: string[] = [];
    const httpGet: GithubHttpGet = async (url, token) => {
      seen.push(token);
      if (url.includes("/notifications") || url.includes("/pulls") || url.includes("/issues")) {
        return { ok: true, status: 200, body: [] };
      }
      return { ok: false, status: 404, body: [] };
    };
    await pollGithubOnce(
      db,
      [{ repo: "acme/demo", projectId: "proj-1" }],
      () => {
        return;
      },
      {
        httpGet,
        token: "gho_oauth_only",
        nowMs: Date.parse("2026-09-16T00:00:00.000Z"),
      },
    );
    assert.equal(seen.includes("gho_oauth_only"), true);
    db.close();
  });
});
