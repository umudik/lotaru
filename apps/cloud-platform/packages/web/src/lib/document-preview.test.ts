import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentPreviewKind } from "./document-preview.js";

describe("documentPreviewKind", () => {
  it("reads markdown and plain text in the pane", () => {
    assert.equal(documentPreviewKind("text/markdown", "guide.md"), "text");
    assert.equal(documentPreviewKind("text/plain", "notes.txt"), "text");
    assert.equal(documentPreviewKind("application/json", "spec.json"), "text");
  });

  it("shows images and pdf inline", () => {
    assert.equal(documentPreviewKind("image/png", "shot.png"), "image");
    assert.equal(documentPreviewKind("application/pdf", "brief.pdf"), "pdf");
  });

  it("falls back to download for office files", () => {
    assert.equal(documentPreviewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "spec.docx"), "binary");
  });
});
