import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseOllamaChat,
  parseOllamaTags,
  polishSystemPrompt,
  summarySystemPrompt,
  translationSystemPrompt,
} from "./ollama.js";

describe("parseOllamaChat", () => {
  it("reads message.content", () => {
    assert.equal(
      parseOllamaChat({
        message: { role: "assistant", content: "  Merhaba  " },
        done: true,
      }),
      "Merhaba",
    );
  });

  it("rejects a missing message", () => {
    assert.throws(() => parseOllamaChat({ done: true }), {
      message: "Ollama returned an unexpected response",
    });
  });
});

describe("parseOllamaTags", () => {
  it("lists model names", () => {
    assert.deepEqual(
      parseOllamaTags({
        models: [{ name: "llama3.2:latest" }, { name: "qwen2.5:7b" }],
      }),
      ["llama3.2:latest", "qwen2.5:7b"],
    );
  });

  it("returns an empty list when Ollama is empty", () => {
    assert.deepEqual(parseOllamaTags({ models: [] }), []);
  });
});

describe("translationSystemPrompt", () => {
  it("asks only for a translation into the target language", () => {
    const prompt = translationSystemPrompt("Turkish");
    assert.match(prompt, /translate/i);
    assert.match(prompt, /Turkish/);
    assert.equal(prompt.includes("guzel"), false);
  });
});

describe("polishSystemPrompt", () => {
  it("repairs Turkish characters without translating", () => {
    const prompt = polishSystemPrompt();
    assert.match(prompt, /guzel/);
    assert.match(prompt, /Do not translate/);
  });
});

describe("summarySystemPrompt", () => {
  it("asks for a short summary in the source language", () => {
    const prompt = summarySystemPrompt();
    assert.match(prompt, /summary/i);
    assert.match(prompt, /same language/);
  });
});
