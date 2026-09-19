import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  findProjectGitLink,
  getProjectGitLink,
  githubWatchesFromLinks,
  insertProjectGitLink,
  listProjectGitLinks,
} from "./git-repo-store.js";
import { closeCachedSqlite } from "./sqlite-cache.js";

describe("git repo store", () => {
  it("stores one repo per project and rejects the same repo twice", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "lotaru-gitstore-"));
    const first = insertProjectGitLink(dataDir, {
      projectId: "proj-a",
      ownerId: "user-1",
      provider: "github",
      owner: "acme",
      repo: "widget",
      branch: "main",
      linkedAt: 1,
    });
    const duplicateRepo = insertProjectGitLink(dataDir, {
      projectId: "proj-b",
      ownerId: "user-1",
      provider: "github",
      owner: "acme",
      repo: "widget",
      branch: "main",
      linkedAt: 2,
    });
    const gitlab = insertProjectGitLink(dataDir, {
      projectId: "proj-c",
      ownerId: "user-1",
      provider: "gitlab",
      owner: "acme",
      repo: "widget",
      branch: "main",
      linkedAt: 3,
    });
    const azure = insertProjectGitLink(dataDir, {
      projectId: "proj-d",
      ownerId: "user-1",
      provider: "azuredevops",
      owner: "fabrikam/Fiber",
      repo: "widget",
      branch: "main",
      linkedAt: 4,
    });
    const bitbucket = insertProjectGitLink(dataDir, {
      projectId: "proj-e",
      ownerId: "user-1",
      provider: "bitbucket",
      owner: "acme",
      repo: "widget",
      branch: "main",
      linkedAt: 5,
    });
    assert.equal(first, true);
    assert.equal(duplicateRepo, false);
    assert.equal(gitlab, true);
    assert.equal(azure, true);
    assert.equal(bitbucket, true);
    const linked = getProjectGitLink(dataDir, "proj-a");
    assert.equal(linked?.repo, "widget");
    assert.equal(findProjectGitLink(dataDir, "github", "acme", "widget")?.projectId, "proj-a");
    const watches = githubWatchesFromLinks(listProjectGitLinks(dataDir));
    assert.equal(watches.length, 1);
    assert.equal(watches[0]?.repo, "acme/widget");
    assert.equal(watches[0]?.projectId, "proj-a");
    closeCachedSqlite();
  });
});
