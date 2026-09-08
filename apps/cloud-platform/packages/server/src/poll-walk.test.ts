import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cutoffMsFrom,
  drainCursorForPage,
  drainPageFromCursor,
  fetchUntilCutoff,
  nextPollDelayMs,
  nextPollWatermark,
  parseIsoMs,
  POLL_OVERLAP_MS,
} from "./poll-walk.js";

describe("poll walk", () => {
  it("parses ISO times and builds an overlap cutoff", () => {
    assert.equal(parseIsoMs("2026-09-08T00:00:00.000Z"), Date.parse("2026-09-08T00:00:00.000Z"));
    assert.equal(parseIsoMs("not-a-date"), 0);
    assert.equal(cutoffMsFrom(0, 1_000_000, POLL_OVERLAP_MS), 880_000);
    assert.equal(cutoffMsFrom(500_000, 1_000_000, 120_000), 380_000);
  });

  it("keeps items at or after the cutoff and stops on an all-stale page", async () => {
    const pages: { t: number }[][] = [
      [{ t: 500 }, { t: 400 }],
      [{ t: 50 }, { t: 40 }],
    ];
    const walked = await fetchUntilCutoff({
      fetchPage: async (page) => {
        const hit = pages[page - 1];
        if (hit === undefined) {
          return [];
        }
        return hit;
      },
      updatedMs: (row) => row.t,
      cutoffMs: 100,
      maxPages: 10,
      pageSize: 2,
    });
    assert.deepEqual(walked.items, [{ t: 500 }, { t: 400 }]);
    assert.equal(walked.lagged, false);
    assert.equal(walked.pages, 2);
  });

  it("marks lag when the last allowed page is still fresh", async () => {
    const walked = await fetchUntilCutoff({
      fetchPage: async (page) => {
        return [
          { t: 1000 - page },
          { t: 999 - page },
        ];
      },
      updatedMs: (row) => row.t,
      cutoffMs: 1,
      maxPages: 2,
      pageSize: 2,
    });
    assert.equal(walked.items.length, 4);
    assert.equal(walked.lagged, true);
  });

  it("does not mark lag on a short last page of fresh items", async () => {
    const walked = await fetchUntilCutoff({
      fetchPage: async (page) => {
        if (page === 1) {
          return [{ t: 200 }, { t: 190 }];
        }
        return [{ t: 180 }];
      },
      updatedMs: (row) => row.t,
      cutoffMs: 100,
      maxPages: 10,
      pageSize: 2,
    });
    assert.equal(walked.items.length, 3);
    assert.equal(walked.lagged, false);
  });

  it("freezes the success watermark while lagged and advances when caught up", () => {
    assert.equal(nextPollWatermark({ lastSuccessAt: 100, nowMs: 200, error: "boom", lagged: false }), 100);
    assert.equal(nextPollWatermark({ lastSuccessAt: 100, nowMs: 200, error: "", lagged: true }), 100);
    assert.equal(nextPollWatermark({ lastSuccessAt: 0, nowMs: 200, error: "", lagged: true }), 200);
    assert.equal(nextPollWatermark({ lastSuccessAt: 100, nowMs: 200, error: "", lagged: false }), 200);
    assert.equal(drainPageFromCursor("page:12"), 12);
    assert.equal(drainPageFromCursor("2026-09-08T00:00:00.000Z"), 1);
    assert.equal(drainCursorForPage(3), "page:3");
  });

  it("polls faster only while catch-up is behind without an HTTP error", () => {
    assert.equal(nextPollDelayMs([]), 30_000);
    assert.equal(nextPollDelayMs([{ lagged: false, lastError: "" }]), 30_000);
    assert.equal(nextPollDelayMs([{ lagged: true, lastError: "" }]), 5_000);
    assert.equal(nextPollDelayMs([{ lagged: true, lastError: "GitHub pulls 502" }]), 30_000);
    assert.equal(
      nextPollDelayMs([
        { lagged: true, lastError: "" },
        { lagged: false, lastError: "Notion poll 429" },
      ]),
      30_000,
    );
  });

  it("skips already-taken items and resumes older pages on the next walk", async () => {
    const pages: { id: string; t: number }[][] = [
      [
        { id: "a", t: 500 },
        { id: "b", t: 400 },
      ],
      [
        { id: "c", t: 300 },
      ],
    ];
    const seen = new Set<string>(["a", "b"]);
    const walked = await fetchUntilCutoff({
      fetchPage: async (page) => {
        const hit = pages[page - 1];
        if (hit === undefined) {
          return [];
        }
        return hit;
      },
      updatedMs: (row) => row.t,
      cutoffMs: 100,
      maxPages: 1,
      pageSize: 2,
      maxWalkPages: 4,
      startPage: 2,
      takeItem: (row) => seen.has(row.id) !== true,
    });
    assert.deepEqual(walked.items, [{ id: "c", t: 300 }]);
    assert.equal(walked.lagged, false);
    assert.equal(walked.nextPage, 1);
  });
});
