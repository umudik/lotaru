import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  edgeVoiceForLanguage,
  languageLabel,
  TARGET_LANGUAGES,
  titleFromBody,
  ttsPreviewLine,
} from "./note-language.js";

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

  it("picks Emel for Turkish speech", () => {
    assert.equal(edgeVoiceForLanguage("tr"), "tr-TR-EmelNeural");
  });

  it("uses a Turkish sample line for voice tests", () => {
    const line = ttsPreviewLine("tr");
    assert.match(line, /ş|ğ|ü|ı|ç|ö/i);
    assert.equal(line.includes("Merhaba"), true);
  });

  it("uses an English sample line when the target is English", () => {
    assert.match(ttsPreviewLine("en"), /Hello/);
  });

  it("returns a spoken sample for every target language", () => {
    for (const lang of TARGET_LANGUAGES) {
      const line = ttsPreviewLine(lang.id);
      assert.equal(line.trim().length > 10, true);
    }
  });

  it("falls back to English for unknown languages", () => {
    assert.match(ttsPreviewLine("xx"), /Hello/);
  });
});
