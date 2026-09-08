import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  HOOK_RETRY_MS,
  hookSyncShouldSkip,
  hookUrlHasToken,
  ingestHookUrl,
  pollDelayWithHookWait,
  syncGithubInboundHooks,
  uniqueGithubRepos,
  type GithubHookHttp,
} from "./github-hooks.js";
import { ensurePollSchema, loadHookSync } from "./poll-store.js";

function memoryDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-ghhook-"));
  const db = new Database(join(dir, "app.sqlite"));
  ensurePollSchema(db);
  return db;
}

describe("github inbound hook sync", () => {
  it("creates a web hook when none matches the ingest token path", async () => {
    const db = memoryDb();
    const calls: { method: string; url: string }[] = [];
    const http: GithubHookHttp = async (url, init) => {
      calls.push({ method: init.method, url });
      if (init.method === "GET") {
        return { ok: true, status: 200, body: [] };
      }
      return { ok: true, status: 201, body: { id: 11 } };
    };
    const ingestUrl = ingestHookUrl("https://abc.trycloudflare.com", "tok_live_1");
    await syncGithubInboundHooks({
      db,
      watches: [{ repo: "umudik/lotaru" }, { repo: "umudik/lotaru" }],
      token: "gho_test",
      ingestUrl,
      nowMs: 1_000_000,
      tunnelLive: true,
      http,
    });
    assert.equal(uniqueGithubRepos([{ repo: "umudik/lotaru" }, { repo: "umudik/lotaru" }]).length, 1);
    assert.equal(calls.some((call) => call.method === "POST" && call.url.endsWith("/hooks")), true);
    const stored = loadHookSync(db, "github", "umudik/lotaru");
    assert.equal(stored.url, ingestUrl);
    assert.equal(stored.lastError, "");
    db.close();
  });

  it("patches config when the token path already exists on an old tunnel URL", async () => {
    const db = memoryDb();
    const calls: { method: string; url: string; body: string }[] = [];
    const ingestUrl = ingestHookUrl("https://new.trycloudflare.com", "tok_live_1");
    const http: GithubHookHttp = async (url, init) => {
      calls.push({ method: init.method, url, body: init.body });
      if (init.method === "GET") {
        return {
          ok: true,
          status: 200,
          body: [
            {
              id: 99,
              name: "web",
              active: true,
              config: { url: "https://old.trycloudflare.com/api/ingest/hooks/tok_live_1" },
            },
          ],
        };
      }
      return { ok: true, status: 200, body: {} };
    };
    await syncGithubInboundHooks({
      db,
      watches: [{ repo: "umudik/lotaru" }],
      token: "gho_test",
      ingestUrl,
      nowMs: 1_000_000,
      tunnelLive: true,
      http,
    });
    const patched = calls.filter((call) => call.method === "PATCH");
    assert.equal(patched.length, 1);
    assert.equal(patched[0]?.url.includes("/hooks/99/config"), true);
    assert.equal(patched[0]?.body.includes("https://new.trycloudflare.com"), true);
    assert.equal(calls.some((call) => call.method === "POST"), false);
    assert.equal(loadHookSync(db, "github", "umudik/lotaru").url, ingestUrl);
    db.close();
  });

  it("skips GitHub when the stored URL already matches", async () => {
    const db = memoryDb();
    const ingestUrl = ingestHookUrl("https://abc.trycloudflare.com", "tok_live_1");
    await syncGithubInboundHooks({
      db,
      watches: [{ repo: "umudik/lotaru" }],
      token: "gho_test",
      ingestUrl,
      nowMs: 50,
      tunnelLive: true,
      http: async (url, init) => {
        if (init.method === "GET") {
          return { ok: true, status: 200, body: [] };
        }
        return { ok: true, status: 201, body: { id: 1 } };
      },
    });
    let hits = 0;
    await syncGithubInboundHooks({
      db,
      watches: [{ repo: "umudik/lotaru" }],
      token: "gho_test",
      ingestUrl,
      nowMs: 80,
      tunnelLive: true,
      http: async () => {
        hits += 1;
        return { ok: true, status: 200, body: [] };
      },
    });
    assert.equal(hits, 0);
    db.close();
  });

  it("stores 403 and does not invent success", async () => {
    const db = memoryDb();
    const ingestUrl = ingestHookUrl("https://abc.trycloudflare.com", "tok_live_1");
    await syncGithubInboundHooks({
      db,
      watches: [{ repo: "umudik/lotaru" }],
      token: "gho_test",
      ingestUrl,
      nowMs: 1_000_000,
      tunnelLive: true,
      http: async () => {
        return { ok: false, status: 403, body: { message: "Resource not accessible by integration" } };
      },
    });
    const stored = loadHookSync(db, "github", "umudik/lotaru");
    assert.equal(stored.lastError, "GitHub webhook 403");
    assert.equal(stored.url, "");
    db.close();
  });

  it("retries errors only after 30s and never while the tunnel is down", async () => {
    const db = memoryDb();
    const ingestUrl = ingestHookUrl("https://abc.trycloudflare.com", "tok_live_1");
    await syncGithubInboundHooks({
      db,
      watches: [{ repo: "umudik/lotaru" }],
      token: "gho_test",
      ingestUrl,
      nowMs: 1_000_000,
      tunnelLive: true,
      http: async () => {
        return { ok: false, status: 403, body: {} };
      },
    });
    let hits = 0;
    const counting: GithubHookHttp = async () => {
      hits += 1;
      return { ok: false, status: 403, body: {} };
    };
    await syncGithubInboundHooks({
      db,
      watches: [{ repo: "umudik/lotaru" }],
      token: "gho_test",
      ingestUrl,
      nowMs: 1_000_000 + HOOK_RETRY_MS - 1,
      tunnelLive: true,
      http: counting,
    });
    assert.equal(hits, 0);
    await syncGithubInboundHooks({
      db,
      watches: [{ repo: "umudik/lotaru" }],
      token: "gho_test",
      ingestUrl,
      nowMs: 1_000_000 + HOOK_RETRY_MS,
      tunnelLive: false,
      http: counting,
    });
    assert.equal(hits, 0);
    await syncGithubInboundHooks({
      db,
      watches: [{ repo: "umudik/lotaru" }],
      token: "gho_test",
      ingestUrl,
      nowMs: 1_000_000 + HOOK_RETRY_MS,
      tunnelLive: true,
      http: counting,
    });
    assert.equal(hits, 1);
    assert.equal(hookUrlHasToken("https://x.example/api/ingest/hooks/tok_live_1", "tok_live_1"), true);
    assert.equal(
      hookSyncShouldSkip({ url: ingestUrl, lastError: "", lastAttemptAt: 1 }, ingestUrl, 99),
      true,
    );
    db.close();
  });

  it("polls every 5s until the tunnel is live so a Quick Tunnel URL can be registered", () => {
    assert.equal(pollDelayWithHookWait(30_000, true), 5_000);
    assert.equal(pollDelayWithHookWait(30_000, false), 30_000);
    assert.equal(pollDelayWithHookWait(4_000, true), 4_000);
  });
});
