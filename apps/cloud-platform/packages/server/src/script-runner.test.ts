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
