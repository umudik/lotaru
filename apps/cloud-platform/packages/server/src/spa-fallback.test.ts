import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiPath, apiRouteMissingBody, shouldServeSpaIndex, spaFileHeaders } from "./spa-fallback.js";

describe("shouldServeSpaIndex", () => {
  it("serves the shell for project routes and keeps assets as real files", () => {
    assert.equal(shouldServeSpaIndex("/"), true);
    assert.equal(shouldServeSpaIndex("/projects/abc/tasks"), true);
    assert.equal(shouldServeSpaIndex("/assets/index-D2jcqBcl.js"), false);
    assert.equal(shouldServeSpaIndex("/assets/index-DCVmiB_d.css"), false);
    assert.equal(shouldServeSpaIndex("/api/knowledge?view=all"), false);
    assert.equal(apiPath("/healthz"), true);
    assert.equal(shouldServeSpaIndex("/healthz"), false);
  });
});

describe("apiRouteMissingBody", () => {
  it("tells operators to restart instead of a bare not found", () => {
    const body = apiRouteMissingBody();
    assert.equal(typeof body.error, "string");
    assert.equal(body.error.includes("restart"), true);
  });
});

describe("spaFileHeaders", () => {
  it("disables caching for index.html only", () => {
    const headers: Record<string, string> = {};
    spaFileHeaders(
      {
        setHeader: (name, value) => {
          headers[name] = value;
        },
      },
      "C:\\lotaru\\packages\\web\\dist\\index.html",
    );
    assert.equal(headers["Cache-Control"], "no-store");
    const assetHeaders: Record<string, string> = {};
    spaFileHeaders(
      {
        setHeader: (name, value) => {
          assetHeaders[name] = value;
        },
      },
      "C:\\lotaru\\packages\\web\\dist\\assets\\index.js",
    );
    assert.equal("Cache-Control" in assetHeaders, false);
  });
});
