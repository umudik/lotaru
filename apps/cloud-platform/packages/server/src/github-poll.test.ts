import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeGithubWatches } from "./github-poll.js";

describe("mergeGithubWatches", () => {
  it("unions reaction repos and folder remotes without duplicates", () => {
    const merged = mergeGithubWatches(
      [{ repo: "umudik/lotaru", projectId: "p1" }, { repo: "", projectId: "p1" }],
      [
        { repo: "umudik/lotaru", projectId: "p1" },
        { repo: "umudik/other", projectId: "p1" },
        { repo: "skip", projectId: "" },
      ],
    );
    assert.deepEqual(merged, [
      { repo: "umudik/lotaru", projectId: "p1" },
      { repo: "umudik/other", projectId: "p1" },
    ]);
  });
});
