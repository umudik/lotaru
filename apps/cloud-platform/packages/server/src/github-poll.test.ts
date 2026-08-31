import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeGithubWatches } from "./github-poll.js";

describe("mergeGithubWatches", () => {
  it("dedupes discovered repos and drops incomplete rows", () => {
    const merged = mergeGithubWatches([
      { repo: "umudik/lotaru", projectId: "p1" },
      { repo: "", projectId: "p1" },
      { repo: "umudik/lotaru", projectId: "p1" },
      { repo: "umudik/other", projectId: "p1" },
      { repo: "skip", projectId: "" },
    ]);
    assert.deepEqual(merged, [
      { repo: "umudik/lotaru", projectId: "p1" },
      { repo: "umudik/other", projectId: "p1" },
    ]);
  });

  it("keeps the same repo when two projects watch it", () => {
    const merged = mergeGithubWatches([
      { repo: "umudik/lotaru", projectId: "p1" },
      { repo: "umudik/lotaru", projectId: "p2" },
    ]);
    assert.equal(merged.length, 2);
  });
});
