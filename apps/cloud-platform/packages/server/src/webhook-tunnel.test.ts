import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { createWebhookTunnel, type TunnelChild } from "./webhook-tunnel.js";

type FakeChild = TunnelChild & {
  stdout: PassThrough;
  stderr: PassThrough;
  fail(err: Error): void;
  exit(code: number): void;
};

function makeChild(): FakeChild {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let closed = false;
  const child: FakeChild = {
    pid: 4242,
    stdout,
    stderr,
    on(event, listener) {
      emitter.on(event, listener);
    },
    once(event, listener) {
      emitter.once(event, listener);
    },
    kill() {
      if (closed) {
        return true;
      }
      closed = true;
      emitter.emit("close", 0);
      return true;
    },
    fail(err) {
      emitter.emit("error", err);
    },
    exit(code) {
      if (closed) {
        return;
      }
      closed = true;
      emitter.emit("close", code);
    },
  };
  return child;
}

describe("webhook tunnel", () => {
  it("boots Cloudflare and records the public URL from stderr", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-tunnel-"));
    const children: FakeChild[] = [];
    const tunnel = createWebhookTunnel({
      databasePath: join(dir, "app.sqlite"),
      dataDir: dir,
      localOrigin: "http://127.0.0.1:4317",
      readyTimeoutMs: 500,
      locateBinary: async () => ["/fake/cloudflared"],
      killChild: (child) => {
        child.kill();
      },
      spawnProcess: () => {
        const child = makeChild();
        children.push(child);
        queueMicrotask(() => {
          child.stderr.write("INF | https://lotaru-demo.trycloudflare.com |\n");
        });
        return child;
      },
    });
    await tunnel.boot();
    const snap = tunnel.snapshot();
    assert.equal(snap.enabled, true);
    assert.equal(snap.provider, "cloudflare");
    assert.equal(snap.state, "up");
    assert.equal(snap.publicUrl, "https://lotaru-demo.trycloudflare.com");
    assert.equal(children.length, 1);
    await tunnel.stop();
  });

  it("does not spawn when the tunnel is disabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-tunnel-"));
    let spawned = 0;
    const tunnel = createWebhookTunnel({
      databasePath: join(dir, "app.sqlite"),
      dataDir: dir,
      localOrigin: "http://127.0.0.1:4317",
      readyTimeoutMs: 200,
      locateBinary: async () => ["/fake/cloudflared"],
      killChild: (child) => {
        child.kill();
      },
      spawnProcess: () => {
        spawned += 1;
        return makeChild();
      },
    });
    await tunnel.apply({
      enabled: false,
      provider: "cloudflare",
      ngrokToken: "",
    });
    await tunnel.boot();
    assert.equal(spawned, 0);
    assert.equal(tunnel.snapshot().state, "off");
    await tunnel.stop();
  });

  it("reports missing_binary when spawn hits ENOENT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-tunnel-"));
    const tunnel = createWebhookTunnel({
      databasePath: join(dir, "app.sqlite"),
      dataDir: dir,
      localOrigin: "http://127.0.0.1:4317",
      readyTimeoutMs: 500,
      locateBinary: async () => ["/missing/cloudflared"],
      killChild: (child) => {
        child.kill();
      },
      spawnProcess: () => {
        const child = makeChild();
        queueMicrotask(() => {
          const err = new Error("spawn ENOENT");
          Object.assign(err, { code: "ENOENT" });
          child.fail(err);
          child.exit(1);
        });
        return child;
      },
    });
    await tunnel.boot();
    assert.equal(tunnel.snapshot().state, "missing_binary");
    await tunnel.stop();
  });

  it("moves to error when the process exits after the URL is live", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-tunnel-"));
    let live: FakeChild | null = null;
    const tunnel = createWebhookTunnel({
      databasePath: join(dir, "app.sqlite"),
      dataDir: dir,
      localOrigin: "http://127.0.0.1:4317",
      readyTimeoutMs: 500,
      locateBinary: async () => ["/fake/cloudflared"],
      killChild: (child) => {
        child.kill();
      },
      spawnProcess: () => {
        const child = makeChild();
        live = child;
        queueMicrotask(() => {
          child.stderr.write("https://live.trycloudflare.com\n");
        });
        return child;
      },
    });
    await tunnel.boot();
    assert.equal(tunnel.snapshot().state, "up");
    if (live === null) {
      throw new Error("expected tunnel child");
    }
    live.exit(1);
    assert.equal(tunnel.snapshot().state, "error");
    assert.equal(tunnel.snapshot().publicUrl, "");
    await tunnel.stop();
  });

  it("refuses ngrok without an authtoken and keeps a stored token on empty PUT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-tunnel-"));
    let spawned = 0;
    const tunnel = createWebhookTunnel({
      databasePath: join(dir, "app.sqlite"),
      dataDir: dir,
      localOrigin: "http://127.0.0.1:4317",
      readyTimeoutMs: 500,
      locateBinary: async () => ["/fake/ngrok"],
      killChild: (child) => {
        child.kill();
      },
      spawnProcess: () => {
        spawned += 1;
        const child = makeChild();
        queueMicrotask(() => {
          child.stdout.write("Forwarding https://keep.ngrok-free.app -> http://127.0.0.1:4317\n");
        });
        return child;
      },
    });
    const missing = await tunnel.apply({
      enabled: true,
      provider: "ngrok",
      ngrokToken: "",
    });
    assert.equal(missing.state, "error");
    assert.equal(spawned, 0);
    const live = await tunnel.apply({
      enabled: true,
      provider: "ngrok",
      ngrokToken: "ngrok-auth-token",
    });
    assert.equal(live.state, "up");
    assert.equal(live.publicUrl, "https://keep.ngrok-free.app");
    assert.equal(live.ngrokConfigured, true);
    const kept = await tunnel.apply({
      enabled: true,
      provider: "ngrok",
      ngrokToken: "",
    });
    assert.equal(kept.ngrokConfigured, true);
    assert.equal(kept.state, "up");
    await tunnel.stop();
  });

  it("downloads cloudflared into the data dir when PATH is empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-tunnel-"));
    let fetched = "";
    let spawnedPath = "";
    const tunnel = createWebhookTunnel({
      databasePath: join(dir, "app.sqlite"),
      dataDir: dir,
      localOrigin: "http://127.0.0.1:4317",
      platform: "linux",
      arch: "x64",
      readyTimeoutMs: 500,
      locateBinary: async () => [],
      fetchBinary: async (url) => {
        fetched = url;
        return new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
      },
      killChild: (child) => {
        child.kill();
      },
      spawnProcess: (command) => {
        spawnedPath = command;
        const child = makeChild();
        queueMicrotask(() => {
          child.stderr.write("https://dl.trycloudflare.com\n");
        });
        return child;
      },
    });
    await tunnel.boot();
    assert.equal(
      fetched,
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
    );
    assert.equal(spawnedPath, join(dir, "bin", "cloudflared"));
    assert.equal(tunnel.snapshot().state, "up");
    await tunnel.stop();
  });
});
