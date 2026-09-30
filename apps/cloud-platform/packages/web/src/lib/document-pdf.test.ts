import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentPdfFilename, markdownToPdfNodes } from "./document-pdf.js";

describe("documentPdfFilename", () => {
  it("uses title and local date", () => {
    const when = new Date(2026, 8, 21, 14, 0, 0);
    assert.equal(documentPdfFilename("Core yapi", when), "Core-yapi-2026-09-21.pdf");
  });

  it("strips path characters and empty titles", () => {
    const when = new Date(2026, 0, 5, 8, 0, 0);
    assert.equal(documentPdfFilename('a/b:c*?"<>|', when), "a-b-c-2026-01-05.pdf");
    assert.equal(documentPdfFilename("   ", when), "document-2026-01-05.pdf");
  });
});

describe("markdownToPdfNodes", () => {
  it("keeps Turkish headings lists and code", () => {
    const markdown = [
      "# Core yapi",
      "",
      "**Durum:** Başarısız",
      "",
      "## Gate",
      "",
      "- observability-cursor.test.ts",
      "1. ilk adim",
      "",
      "```",
      "true !== false",
      "```",
    ].join("\n");
    const nodes = markdownToPdfNodes(markdown);
    const texts = nodes
      .filter((node) => node.kind === "text")
      .map((node) => node.text);
    assert.equal(texts.includes("Core yapi"), true);
    assert.equal(texts.some((text) => text.includes("Başarısız")), true);
    assert.equal(texts.includes("Gate"), true);
    assert.equal(texts.some((text) => text.includes("true !== false")), true);
    const lists = nodes.filter((node) => node.kind === "ul" || node.kind === "ol");
    assert.equal(lists.length >= 1, true);
  });

  it("returns empty for blank markdown", () => {
    assert.deepEqual(markdownToPdfNodes("   \n"), []);
  });
});
