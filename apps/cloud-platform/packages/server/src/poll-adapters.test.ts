import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { ensureConnectionSchema, saveConnectionSecret } from "./connection-store.js";
import { ensureGithubSchema } from "./github-store.js";
import { ensurePollSchema, loadPollCursor } from "./poll-store.js";
import { parseJiraSecret, pollConnectedAdapters, type AdapterHttp } from "./poll-adapters.js";

describe("poll adapters", () => {
  it("primes an RSS feed then emits new guids", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-rss-"));
    const db = new Database(join(dir, "app.sqlite"));
    ensureGithubSchema(db);
    ensureConnectionSchema(db);
    ensurePollSchema(db);
    saveConnectionSecret(db, "rss", "https://example.com/feed.xml");
    const firstXml =
      "<rss><channel><item><guid>item-a</guid></item><item><guid>item-b</guid></item></channel></rss>";
    const secondXml =
      "<rss><channel><item><guid>item-c</guid></item><item><guid>item-a</guid></item></channel></rss>";
    let round = 0;
    const http: AdapterHttp = async () => {
      round += 1;
      const text = round === 1 ? firstXml : secondXml;
      return { ok: true, status: 200, body: text, text };
    };
    const emitted: string[] = [];
    await pollConnectedAdapters(db, ["proj-1"], (event) => {
      emitted.push(event.detail);
    }, { http, nowMs: 1_000_000 });
    assert.deepEqual(emitted, []);
    await pollConnectedAdapters(db, ["proj-1"], (event) => {
      emitted.push(event.detail);
    }, { http, nowMs: 1_030_000 });
    assert.deepEqual(emitted, ["item-c"]);
    db.close();
  });

  it("parses a Jira Cloud secret and primes then emits a new issue", async () => {
    assert.equal(parseJiraSecret("not-a-site user@x.atlassian.net tokenvalue").length, 0);
    const cred = parseJiraSecret("https://acme.atlassian.net owner@acme.com tokenvalue");
    assert.equal(cred.length, 1);
    const dir = mkdtempSync(join(tmpdir(), "lotaru-jira-"));
    const db = new Database(join(dir, "app.sqlite"));
    ensureGithubSchema(db);
    ensureConnectionSchema(db);
    ensurePollSchema(db);
    saveConnectionSecret(db, "jira", "https://acme.atlassian.net owner@acme.com tokenvalue");
    const issueA = {
      id: "1",
      key: "LOT-1",
      fields: {
        summary: "Old",
        updated: "2026-09-08T00:01:00.000Z",
        created: "2026-09-08T00:01:00.000Z",
      },
    };
    const issueB = {
      id: "2",
      key: "LOT-2",
      fields: {
        summary: "New work",
        updated: "2026-09-08T00:03:00.000Z",
        created: "2026-09-08T00:03:00.000Z",
      },
    };
    let round = 0;
    const http: AdapterHttp = async (url, init) => {
      assert.equal(url.endsWith("/rest/api/3/search/jql"), true);
      assert.equal(init.method, "POST");
      round += 1;
      const issues = round === 1 ? [issueA] : [issueB, issueA];
      return { ok: true, status: 200, body: { issues, isLast: true }, text: "" };
    };
    const emitted: string[] = [];
    await pollConnectedAdapters(
      db,
      ["proj-1"],
      (event) => {
        emitted.push(`${event.type}:${event.path}`);
      },
      { http, nowMs: Date.parse("2026-09-08T00:02:00.000Z") },
    );
    assert.deepEqual(emitted, []);
    assert.equal(loadPollCursor(db, "jira", "account").primed, true);
    await pollConnectedAdapters(
      db,
      ["proj-1"],
      (event) => {
        emitted.push(`${event.type}:${event.path}`);
      },
      { http, nowMs: Date.parse("2026-09-08T00:04:00.000Z") },
    );
    assert.equal(emitted.includes("jira.issue.created:LOT-2"), true);
    db.close();
  });
});
