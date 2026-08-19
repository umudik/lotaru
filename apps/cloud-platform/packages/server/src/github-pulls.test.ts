import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EVENT_GITHUB_PR_MERGED,
  EVENT_GITHUB_PR_OPENED,
  EVENT_GITHUB_PR_UPDATED,
} from "./events.js";
import {
  classifyPullChange,
  githubRepoFromRemoteUrl,
  githubReposFromRemoteListing,
  parseGithubPulls,
  splitGithubRepo,
} from "./github-pulls.js";

describe("parseGithubPulls", () => {
  it("maps GitHub list payloads and empty merged_at", () => {
    const pulls = parseGithubPulls([
      {
        number: 12,
        state: "open",
        updated_at: "2026-01-01T00:00:00Z",
        merged_at: null,
        title: "Fix lint",
      },
    ]);
    assert.equal(pulls.length, 1);
    const first = pulls[0];
    if (first === undefined) {
      assert.fail("expected a pull");
      return;
    }
    assert.equal(first.number, 12);
    assert.equal(first.mergedAt, "");
  });
});

describe("classifyPullChange", () => {
  it("stays silent on the first snapshot then emits opened, updated, merged", () => {
    const next = {
      number: 12,
      updatedAt: "2026-01-01T00:00:00Z",
      mergedAt: "",
      state: "open",
      title: "Fix lint",
    };
    assert.equal(classifyPullChange(false, next, false), "");
    assert.equal(classifyPullChange(false, next, true), EVENT_GITHUB_PR_OPENED);
    assert.equal(
      classifyPullChange(next, Object.assign({}, next, { updatedAt: "2026-01-02T00:00:00Z" }), true),
      EVENT_GITHUB_PR_UPDATED,
    );
    assert.equal(
      classifyPullChange(next, Object.assign({}, next, { mergedAt: "2026-01-03T00:00:00Z" }), true),
      EVENT_GITHUB_PR_MERGED,
    );
  });
});

describe("splitGithubRepo", () => {
  it("requires owner/name", () => {
    const ok = splitGithubRepo("umudik/lotaru");
    assert.equal(ok.owner, "umudik");
    assert.equal(ok.name, "lotaru");
    const bad = splitGithubRepo("lotaru");
    assert.equal(bad.owner, "");
  });
});

describe("githubRepoFromRemoteUrl", () => {
  it("reads HTTPS, SSH, and ssh:// GitHub remotes", () => {
    assert.equal(githubRepoFromRemoteUrl("https://github.com/umudik/lotaru.git"), "umudik/lotaru");
    assert.equal(githubRepoFromRemoteUrl("git@github.com:umudik/lotaru.git"), "umudik/lotaru");
    assert.equal(
      githubRepoFromRemoteUrl("ssh://git@github.com/umudik/lotaru.git"),
      "umudik/lotaru",
    );
    assert.equal(githubRepoFromRemoteUrl("https://gitlab.com/umudik/lotaru.git"), "");
  });
});

describe("githubReposFromRemoteListing", () => {
  it("dedupes fetch/push and puts origin first", () => {
    const listed = githubReposFromRemoteListing(
      [
        "upstream\tgit@github.com:other/fork.git (fetch)",
        "upstream\tgit@github.com:other/fork.git (push)",
        "origin\thttps://github.com/umudik/lotaru.git (fetch)",
        "origin\thttps://github.com/umudik/lotaru.git (push)",
      ].join("\n"),
    );
    assert.deepEqual(listed, ["umudik/lotaru", "other/fork"]);
  });
});
