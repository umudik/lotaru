import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EVENT_GITHUB_PR_MERGED,
  EVENT_GITHUB_PR_OPENED,
  EVENT_GITHUB_PR_UPDATED,
} from "./events.js";
import {
  classifyIssueChange,
  classifyPullChange,
  githubRepoFromRemoteUrl,
  githubReposFromRemoteListing,
  mapGithubNotificationType,
  parseGithubIssues,
  parseGithubNotifications,
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

describe("github issues and notifications", () => {
  it("drops pull requests from the issues list and maps notification subjects", () => {
    const issues = parseGithubIssues([
      {
        number: 3,
        updated_at: "2026-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
        title: "Bug",
      },
      {
        number: 4,
        updated_at: "2026-01-01T00:00:00Z",
        created_at: "2026-01-01T00:00:00Z",
        title: "PR",
        pull_request: { url: "https://api.github.com/repos/a/b/pulls/4" },
      },
    ]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.number, 3);
    assert.equal(classifyIssueChange(false, true), "github.issues");
    assert.equal(classifyIssueChange(false, false), "");
    assert.equal(mapGithubNotificationType("CheckSuite"), "github.check_suite");
    assert.equal(mapGithubNotificationType("PullRequest"), "");
    const notes = parseGithubNotifications([
      {
        id: 99,
        updated_at: "2026-01-01T00:00:00Z",
        repository: { full_name: "umudik/lotaru" },
        subject: { type: "Release", title: "v1" },
      },
    ]);
    assert.equal(notes[0]?.id, "99");
    assert.equal(notes[0]?.subjectType, "Release");
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
