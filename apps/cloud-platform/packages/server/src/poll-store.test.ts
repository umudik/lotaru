import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  connectorIdForHookToken,
  hookTokenFor,
  loadHookSync,
  loadPollCursor,
  pollFingerprintSeen,
  rememberPollFingerprint,
  saveHookSync,
  savePollCursor,
} from "./poll-store.js";

describe("poll store", () => {
  it("round-trips a cursor, fingerprints, and hook tokens", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-poll-"));
    const db = new Database(join(dir, "app.sqlite"));
    const empty = loadPollCursor(db, "github", "umudik/lotaru");
    assert.equal(empty.primed, false);
    savePollCursor(db, {
      connector: "github",
      scope: "umudik/lotaru",
      cursor: "2026-09-08T00:00:00.000Z",
      primed: true,
      lastSuccessAt: 42,
      lastError: "",
      lagged: false,
    });
    const loaded = loadPollCursor(db, "github", "umudik/lotaru");
    assert.equal(loaded.primed, true);
    assert.equal(loaded.lastSuccessAt, 42);
    assert.equal(pollFingerprintSeen(db, "github", "umudik/lotaru", "issue:1"), false);
    rememberPollFingerprint(db, "github", "umudik/lotaru", "issue:1");
    assert.equal(pollFingerprintSeen(db, "github", "umudik/lotaru", "issue:1"), true);
    const token = hookTokenFor(db, "github");
    assert.equal(token.length > 10, true);
    assert.equal(hookTokenFor(db, "github"), token);
    assert.equal(connectorIdForHookToken(db, token), "github");
    assert.equal(connectorIdForHookToken(db, "missing-token"), "");
    saveHookSync(db, {
      connector: "github",
      repo: "umudik/lotaru",
      url: "https://abc.trycloudflare.com/api/ingest/hooks/tok",
      lastError: "",
      lastAttemptAt: 9,
    });
    const synced = loadHookSync(db, "github", "umudik/lotaru");
    assert.equal(synced.url.includes("tok"), true);
    assert.equal(synced.lastAttemptAt, 9);
    db.close();
  });
});
