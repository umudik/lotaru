import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { requireExistingDirectory } from "./folder-path.js";

describe("requireExistingDirectory", () => {
  it("returns an existing directory path", () => {
    const dir = join(tmpdir(), `lotaru-folder-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    assert.equal(requireExistingDirectory(dir), dir);
  });

  it("rejects a missing path", () => {
    assert.throws(() => requireExistingDirectory(join(tmpdir(), "lotaru-missing-folder-xyz")), {
      message: "Folder path does not exist",
    });
  });

  it("rejects a file path", () => {
    const filePath = join(tmpdir(), `lotaru-file-${Date.now()}.txt`);
    writeFileSync(filePath, "x");
    assert.throws(() => requireExistingDirectory(filePath), {
      message: "Folder path is not a directory",
    });
  });

  it("rejects an empty path", () => {
    assert.throws(() => requireExistingDirectory("   "), {
      message: "Folder path is required",
    });
  });

  it("rejects a relative path", () => {
    assert.throws(() => requireExistingDirectory("relative-folder"), {
      message: "Folder path must be absolute",
    });
  });
});
