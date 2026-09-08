import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { parseEnvVarsBody, validateCreateScript } from "./modules/script-runner.js";
import { createIdentity } from "./modules/identity.js";
import { registerScriptRunnerModule } from "./modules/script-runner.js";

async function startScriptRunner() {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-script-runner-"));
  const app = Fastify({ logger: false });
  const identity = await createIdentity({
    publicUrl: "http://127.0.0.1:4317",
    dataDir: dir,
  });
  await registerScriptRunnerModule(app, {
    identity,
    dataDir: dir,
    databasePath: join(dir, "app.sqlite"),
  });
  return { app, dir };
}

describe("parseEnvVarsBody", () => {
  it("accepts string values and rejects invalid shapes", () => {
    assert.deepEqual(parseEnvVarsBody({ FOO: "bar" }), { FOO: "bar" });
    assert.deepEqual(parseEnvVarsBody(undefined), {});
    assert.equal(parseEnvVarsBody(null), "vars must be object");
    assert.equal(parseEnvVarsBody({ "": "x" }), "env key cannot be empty");
    assert.equal(parseEnvVarsBody({ FOO: 1 }), "env value for FOO must be string");
  });
});

describe("validateCreateScript", () => {
  it("requires name, command, runtime, trigger, and concurrency", () => {
    const ok = validateCreateScript({
      name: "Build",
      command: "npm test",
      runtime: "shell",
      trigger_type: "manual",
      concurrency: "queue",
    });
    assert.notEqual(typeof ok, "string");
    if (typeof ok === "string") {
      assert.fail(ok);
    }
    assert.equal(ok.name, "Build");
    assert.equal(ok.runtime, "shell");
  });

  it("requires a bus event for event triggers and maps leftover scheduled to event", () => {
    assert.equal(
      validateCreateScript({
        name: "Build",
        command: "npm test",
        runtime: "shell",
        trigger_type: "event",
        concurrency: "queue",
      }),
      "trigger_bus_event required for event trigger",
    );
    const mapped = validateCreateScript({
      name: "Tick",
      command: "echo hi",
      runtime: "shell",
      trigger_type: "scheduled",
      concurrency: "ignore",
    });
    assert.notEqual(typeof mapped, "string");
    if (typeof mapped === "string") {
      assert.fail(mapped);
    }
    assert.equal(mapped.trigger_type, "event");
    assert.equal(mapped.trigger_bus_event, "clock.tick");
    assert.equal(mapped.trigger_cron, "");
    const named = validateCreateScript({
      name: "Hourly",
      command: "echo hi",
      runtime: "shell",
      trigger_type: "event",
      trigger_bus_event: "clock.every_1h",
      concurrency: "ignore",
    });
    assert.notEqual(typeof named, "string");
    if (typeof named === "string") {
      assert.fail(named);
    }
    assert.equal(named.trigger_type, "event");
    assert.equal(named.trigger_bus_event, "clock.every_1h");
  });

  it("fail-closes on missing command", () => {
    assert.equal(
      validateCreateScript({
        name: "Build",
        command: "",
        runtime: "shell",
        trigger_type: "manual",
        concurrency: "queue",
      }),
      "command required",
    );
  });
});

describe("registerScriptRunnerModule", () => {
  it("serves agent status and shuts down cleanly", async (t) => {
    const { app } = await startScriptRunner();
    t.after(async () => {
      await app.close();
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/agent/status",
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().online, true);
  });
});
