import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadTunnelSettings, saveTunnelSettings, tunnelDatabase } from "./tunnel-store.js";

describe("tunnel store", () => {
  it("defaults to Cloudflare enabled with no ngrok token", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-tunnel-"));
    const db = tunnelDatabase(join(dir, "app.sqlite"));
    const loaded = loadTunnelSettings(db);
    assert.equal(loaded.enabled, true);
    assert.equal(loaded.provider, "cloudflare");
    assert.equal(loaded.ngrokToken, "");
    db.close();
  });

  it("persists provider, enabled flag, and token", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-tunnel-"));
    const db = tunnelDatabase(join(dir, "app.sqlite"));
    saveTunnelSettings(db, {
      enabled: false,
      provider: "ngrok",
      ngrokToken: "ngrok-auth-token",
    });
    const loaded = loadTunnelSettings(db);
    assert.equal(loaded.enabled, false);
    assert.equal(loaded.provider, "ngrok");
    assert.equal(loaded.ngrokToken, "ngrok-auth-token");
    db.close();
  });
});
