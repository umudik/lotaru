import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { detectGitCheckout } from "./github-remote.js";

describe("detectGitCheckout", () => {
  it("follows origin when the folder is already a clone", async () => {
    const root = mkdtempSync(join(tmpdir(), "lotaru-gitdetect-"));
    const repoDir = join(root, "checkout");
    mkdirSync(repoDir);
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/from-folder.git"], {
      cwd: repoDir,
      stdio: "ignore",
    });
    const detected = await detectGitCheckout(repoDir);
    assert.equal(detected.length, 1);
    assert.equal(detected[0]?.provider, "github");
    assert.equal(detected[0]?.owner, "acme");
    assert.equal(detected[0]?.repo, "from-folder");
  });

  it("returns nothing for a folder that is not a git checkout", async () => {
    const root = mkdtempSync(join(tmpdir(), "lotaru-nogit-"));
    const detected = await detectGitCheckout(root);
    assert.equal(detected.length, 0);
  });
});
