import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldIgnoreWatchPath } from "./file-watch.js";

describe("shouldIgnoreWatchPath", () => {
  it("skips dependency and VCS directories", () => {
    assert.equal(shouldIgnoreWatchPath("/work/app/node_modules/pkg/index.js"), true);
    assert.equal(shouldIgnoreWatchPath("/work/app/.git/HEAD"), true);
    assert.equal(shouldIgnoreWatchPath("/work/app/src/index.ts"), false);
  });

  it("skips sqlite databases and wal sidecars", () => {
    assert.equal(shouldIgnoreWatchPath("/data/app.sqlite"), true);
    assert.equal(shouldIgnoreWatchPath("/data/app.sqlite-wal"), true);
    assert.equal(shouldIgnoreWatchPath("/data/app.sqlite-shm"), true);
    assert.equal(shouldIgnoreWatchPath("/work/app/bridge.db-wal"), true);
    assert.equal(shouldIgnoreWatchPath("/work/app/users.sqlite-journal"), true);
  });

  it("skips machine-local cache directories", () => {
    assert.equal(shouldIgnoreWatchPath("/home/user/.aws/credentials"), true);
    assert.equal(shouldIgnoreWatchPath("/work/app/.cache/foo"), true);
  });

  it("skips mesh and raster assets that lock under OneDrive", () => {
    assert.equal(
      shouldIgnoreWatchPath("/work/packages/craft/src/ui/client/assets/robot-arm-a.obj"),
      true,
    );
    assert.equal(shouldIgnoreWatchPath("/work/app/src/index.ts"), false);
  });

  it("skips editor scratch under .impeccable", () => {
    assert.equal(
      shouldIgnoreWatchPath("/work/packages/craft/.impeccable/questions/00b6e7b5.state.json"),
      true,
    );
  });
});
