import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { languageLabel, TARGET_LANGUAGES, titleFromBody } from "./note-language.js";

describe("titleFromBody", () => {
  it("uses the first line", () => {
    assert.equal(titleFromBody("Hello world\nMore text"), "Hello world");
  });

  it("falls back when empty", () => {
    assert.equal(titleFromBody("   \n"), "Untitled note");
  });

  it("truncates long first lines", () => {
    const longLine = "a".repeat(90);
    const title = titleFromBody(longLine);
    assert.equal(title.length <= 80, true);
  });
});

describe("language helpers", () => {
  it("labels Turkish", () => {
    assert.equal(languageLabel("tr"), "Turkish");
  });

  it("returns the id when the language is unknown", () => {
    assert.equal(languageLabel("xx"), "xx");
  });

  it("lists a label for every target language", () => {
    for (const lang of TARGET_LANGUAGES) {
      assert.equal(languageLabel(lang.id), lang.label);
    }
  });
});
