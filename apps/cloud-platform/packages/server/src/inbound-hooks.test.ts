import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { HOOK_RETRY_MS, ingestHookUrl } from "./github-hooks.js";
import { HOOK_ACCOUNT_SCOPE, syncLinearInboundHook, syncStripeInboundHook, type InboundHookHttp } from "./inbound-hooks.js";
import { ensurePollSchema, loadHookSync } from "./poll-store.js";

function memoryDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-inhook-"));
  const db = new Database(join(dir, "app.sqlite"));
  ensurePollSchema(db);
  return db;
}

describe("linear inbound hook sync", () => {
  it("creates a Linear webhook when none matches the ingest token path", async () => {
    const db = memoryDb();
    const calls: { body: string }[] = [];
    const ingestUrl = ingestHookUrl("https://abc.trycloudflare.com", "tok_live_1");
    const http: InboundHookHttp = async (_url, init) => {
      calls.push({ body: init.body });
      if (init.body.includes("webhooks(first: 50)")) {
        return { ok: true, status: 200, body: { data: { webhooks: { nodes: [], pageInfo: { hasNextPage: false } } } } };
      }
      return {
        ok: true,
        status: 200,
        body: { data: { webhookCreate: { success: true, webhook: { id: "wh-1" } } } },
      };
    };
    await syncLinearInboundHook({
      db,
      token: "lin_test",
      ingestUrl,
      nowMs: 1_000_000,
      tunnelLive: true,
      http,
    });
    assert.equal(calls.some((call) => call.body.includes("webhookCreate")), true);
    const stored = loadHookSync(db, "linear", HOOK_ACCOUNT_SCOPE);
    assert.equal(stored.url, ingestUrl);
    assert.equal(stored.lastError, "");
    db.close();
  });

  it("updates Linear when the token path already exists on an old tunnel URL", async () => {
    const db = memoryDb();
    const ingestUrl = ingestHookUrl("https://new.trycloudflare.com", "tok_live_1");
    const calls: { body: string }[] = [];
    const http: InboundHookHttp = async (_url, init) => {
      calls.push({ body: init.body });
      if (init.body.includes("webhooks(first: 50)")) {
        return {
          ok: true,
          status: 200,
          body: {
            data: {
              webhooks: {
                nodes: [
                  {
                    id: "wh-9",
                    url: "https://old.trycloudflare.com/api/ingest/hooks/tok_live_1",
                    enabled: true,
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        };
      }
      return {
        ok: true,
        status: 200,
        body: { data: { webhookUpdate: { success: true, webhook: { id: "wh-9" } } } },
      };
    };
    await syncLinearInboundHook({
      db,
      token: "lin_test",
      ingestUrl,
      nowMs: 1_000_000,
      tunnelLive: true,
      http,
    });
    assert.equal(calls.some((call) => call.body.includes("webhookUpdate")), true);
    assert.equal(calls.some((call) => call.body.includes("webhookCreate")), false);
    assert.equal(loadHookSync(db, "linear", HOOK_ACCOUNT_SCOPE).url, ingestUrl);
    db.close();
  });

  it("stores a Linear GraphQL admin error and does not invent success", async () => {
    const db = memoryDb();
    const ingestUrl = ingestHookUrl("https://abc.trycloudflare.com", "tok_live_1");
    await syncLinearInboundHook({
      db,
      token: "lin_test",
      ingestUrl,
      nowMs: 1_000_000,
      tunnelLive: true,
      http: async () => {
        return {
          ok: true,
          status: 200,
          body: { errors: [{ message: "You must be an admin to create webhooks" }] },
        };
      },
    });
    const stored = loadHookSync(db, "linear", HOOK_ACCOUNT_SCOPE);
    assert.equal(stored.lastError, "You must be an admin to create webhooks");
    assert.equal(stored.url, "");
    db.close();
  });
});

describe("stripe inbound hook sync", () => {
  it("creates a Stripe endpoint when none matches the ingest token path", async () => {
    const db = memoryDb();
    const calls: { method: string; url: string; body: string }[] = [];
    const ingestUrl = ingestHookUrl("https://abc.trycloudflare.com", "tok_live_1");
    const http: InboundHookHttp = async (url, init) => {
      calls.push({ method: init.method, url, body: init.body });
      if (init.method === "GET") {
        return { ok: true, status: 200, body: { data: [], has_more: false } };
      }
      return { ok: true, status: 200, body: { id: "we_1" } };
    };
    await syncStripeInboundHook({
      db,
      token: "sk_test",
      ingestUrl,
      nowMs: 1_000_000,
      tunnelLive: true,
      http,
    });
    const created = calls.filter((call) => call.method === "POST" && call.url.endsWith("/webhook_endpoints"));
    assert.equal(created.length, 1);
    assert.equal(created[0]?.body.includes("enabled_events"), true);
    assert.equal(loadHookSync(db, "stripe", HOOK_ACCOUNT_SCOPE).lastError, "");
    db.close();
  });

  it("updates Stripe when the token path already exists on an old tunnel URL", async () => {
    const db = memoryDb();
    const ingestUrl = ingestHookUrl("https://new.trycloudflare.com", "tok_live_1");
    const calls: { method: string; url: string; body: string }[] = [];
    const http: InboundHookHttp = async (url, init) => {
      calls.push({ method: init.method, url, body: init.body });
      if (init.method === "GET") {
        return {
          ok: true,
          status: 200,
          body: {
            data: [
              {
                id: "we_9",
                url: "https://old.trycloudflare.com/api/ingest/hooks/tok_live_1",
                status: "enabled",
              },
            ],
            has_more: false,
          },
        };
      }
      return { ok: true, status: 200, body: { id: "we_9" } };
    };
    await syncStripeInboundHook({
      db,
      token: "sk_test",
      ingestUrl,
      nowMs: 1_000_000,
      tunnelLive: true,
      http,
    });
    const patched = calls.filter((call) => call.method === "POST" && call.url.includes("/webhook_endpoints/we_9"));
    assert.equal(patched.length, 1);
    assert.equal(patched[0]?.body.includes("new.trycloudflare.com"), true);
    assert.equal(calls.some((call) => call.url.endsWith("/webhook_endpoints") && call.method === "POST"), false);
    assert.equal(loadHookSync(db, "stripe", HOOK_ACCOUNT_SCOPE).url, ingestUrl);
    db.close();
  });

  it("skips Stripe when the stored URL already matches and retries 403 after 30s", async () => {
    const db = memoryDb();
    const ingestUrl = ingestHookUrl("https://abc.trycloudflare.com", "tok_live_1");
    await syncStripeInboundHook({
      db,
      token: "sk_test",
      ingestUrl,
      nowMs: 50,
      tunnelLive: true,
      http: async (_url, init) => {
        if (init.method === "GET") {
          return { ok: true, status: 200, body: { data: [], has_more: false } };
        }
        return { ok: true, status: 200, body: { id: "we_1" } };
      },
    });
    let hits = 0;
    await syncStripeInboundHook({
      db,
      token: "sk_test",
      ingestUrl,
      nowMs: 80,
      tunnelLive: true,
      http: async () => {
        hits += 1;
        return { ok: true, status: 200, body: { data: [], has_more: false } };
      },
    });
    assert.equal(hits, 0);
    await syncStripeInboundHook({
      db,
      token: "sk_test",
      ingestUrl: ingestHookUrl("https://other.trycloudflare.com", "tok_live_1"),
      nowMs: 1_000_000,
      tunnelLive: true,
      http: async () => {
        return { ok: false, status: 403, body: { error: { message: "invalid api key" } } };
      },
    });
    assert.equal(loadHookSync(db, "stripe", HOOK_ACCOUNT_SCOPE).lastError, "invalid api key");
    hits = 0;
    await syncStripeInboundHook({
      db,
      token: "sk_test",
      ingestUrl: ingestHookUrl("https://other.trycloudflare.com", "tok_live_1"),
      nowMs: 1_000_000 + HOOK_RETRY_MS - 1,
      tunnelLive: true,
      http: async () => {
        hits += 1;
        return { ok: false, status: 403, body: { error: { message: "invalid api key" } } };
      },
    });
    assert.equal(hits, 0);
    db.close();
  });
});
