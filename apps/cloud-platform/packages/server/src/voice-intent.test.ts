import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseVoiceIntentDecision, voiceIntentScannerPrompt } from "./voice-intent.js";

describe("parseVoiceIntentDecision", () => {
  it("parses bare json", () => {
    const rows = parseVoiceIntentDecision(
      '{"emit":true,"title":"Create task","summary":"Write the report","reason":"clear ask"}',
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].emit, true);
    assert.equal(rows[0].title, "Create task");
  });

  it("fail-closes on garbage", () => {
    assert.equal(parseVoiceIntentDecision("not json").length, 0);
    assert.equal(parseVoiceIntentDecision("").length, 0);
  });

  it("parses fenced json", () => {
    const rows = parseVoiceIntentDecision(
      "```json\n{\"emit\":false,\"title\":\"\",\"summary\":\"\",\"reason\":\"greeting\"}\n```",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].emit, false);
  });
});

describe("voiceIntentScannerPrompt", () => {
  it("includes rolling and latest text", () => {
    const prompt = voiceIntentScannerPrompt({
      rollingTranscript: "Selam.\nNasılsın?",
      latestUtterance: "Bunu task olarak yaz.",
    });
    assert.equal(prompt.includes("Selam."), true);
    assert.equal(prompt.includes("Bunu task olarak yaz."), true);
  });
});
