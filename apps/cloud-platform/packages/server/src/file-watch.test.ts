import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldIgnoreWatchPath } from "./file-watch.js";

describe("shouldIgnoreWatchPath", () => {
  it("skips dependency and VCS directories", () => {
    assert.equal(shouldIgnoreWatchPath("/work/app/node_modules/pkg/index.js"), true);
    assert.equal(shouldIgnoreWatchPath("/work/app/.git/HEAD"), true);
    assert.equal(shouldIgnoreWatchPath("/work/app/src/index.ts"), false);
  });
});
