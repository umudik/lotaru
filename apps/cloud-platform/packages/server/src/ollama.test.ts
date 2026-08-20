import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextRetryDelayMs,
  ollamaChatRequestBody,
  ollamaJobRetryKey,
  OLLAMA_MODEL_REQUIRED,
  parseOllamaChat,
  parseOllamaTags,
  polishSystemPrompt,
  shouldRetryOllama,
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

  it("rejects empty assistant content", () => {
    assert.throws(
      () =>
        parseOllamaChat({
          message: { role: "assistant", content: "   ", thinking: "reasoned in silence" },
          done: true,
        }),
      { message: /empty text/ },
    );
  });

  it("rejects a missing message", () => {
    assert.throws(() => parseOllamaChat({ done: true }), {
      message: "Ollama returned an unexpected response",
    });
  });
});

describe("ollamaChatRequestBody", () => {
  it("turns thinking off at the top level", () => {
    const body = ollamaChatRequestBody("qwen3.6:latest", "system", "hello");
    assert.equal(body.think, false);
    assert.equal(body.stream, false);
    assert.equal(body.options.num_predict, 4096);
    assert.equal(body.keep_alive, "30m");
    assert.equal(body.messages[0]?.role, "system");
    assert.equal(body.messages[1]?.content, "hello");
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

describe("shouldRetryOllama", () => {
  it("does not retry a missing model", () => {
    assert.equal(shouldRetryOllama(OLLAMA_MODEL_REQUIRED), false);
  });

  it("retries empty replies and network failures", () => {
    assert.equal(shouldRetryOllama("Ollama returned empty text. Retry, or pick a smaller model in Settings."), true);
    assert.equal(shouldRetryOllama("Ollama is not reachable (500)"), true);
    assert.equal(shouldRetryOllama("fetch failed"), true);
  });
});

describe("nextRetryDelayMs", () => {
  it("backs off then caps at 30 seconds", () => {
    assert.equal(nextRetryDelayMs(1), 2000);
    assert.equal(nextRetryDelayMs(2), 4000);
    assert.equal(nextRetryDelayMs(3), 8000);
    assert.equal(nextRetryDelayMs(4), 16000);
    assert.equal(nextRetryDelayMs(5), 30000);
    assert.equal(nextRetryDelayMs(9), 30000);
  });
});

describe("ollamaJobRetryKey", () => {
  it("joins kind and page id", () => {
    assert.equal(ollamaJobRetryKey("translate", "page-1"), "translate:page-1");
  });
});
