import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { createIdentity } from "./modules/identity.js";
import { registerClockSchedulesModule } from "./modules/clock-schedules.js";

async function startClockApi() {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-clock-api-"));
  const app = Fastify({ logger: false });
  const identity = await createIdentity({
    publicUrl: "http://127.0.0.1:4317",
    dataDir: dir,
  });
  await registerClockSchedulesModule(app, {
    databasePath: join(dir, "app.sqlite"),
    identity,
  });
  return { app };
}

describe("clock schedules API", () => {
  it("lists builtins and lets a custom time be added and removed", async (t) => {
    const { app } = await startClockApi();
    t.after(async () => {
      await app.close();
    });
    const listed = await app.inject({ method: "GET", url: "/api/clock-schedules" });
    assert.equal(listed.statusCode, 200);
    const body = listed.json() as {
      schedules: { id: string; slug: string; builtin: boolean; eventType: string }[];
    };
    assert.equal(body.schedules.length >= 16, true);
    const created = await app.inject({
      method: "POST",
      url: "/api/clock-schedules",
      payload: { title: "Standup", cron: "0 10 * * 1,2,3,4,5" },
    });
    assert.equal(created.statusCode, 201);
    const row = created.json() as { id: string; slug: string; eventType: string; builtin: boolean };
    assert.equal(row.slug, "standup");
    assert.equal(row.eventType, "clock.at.standup");
    assert.equal(row.builtin, false);
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/clock-schedules/${row.id}`,
      payload: { enabled: false },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(patched.json().enabled, false);
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/clock-schedules/${row.id}`,
    });
    assert.equal(removed.statusCode, 204);
    const builtin = body.schedules.find((entry) => entry.slug === "hourly");
    if (builtin === undefined) {
      assert.fail("hourly builtin missing");
      return;
    }
    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/clock-schedules/${builtin.id}`,
    });
    assert.equal(blocked.statusCode, 400);
  });
});
