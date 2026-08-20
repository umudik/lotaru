import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_APP_SETTINGS, parseSettingsInput, type AppSettings } from "./app-settings.js";
import { resolveEdgeVoice, resolveQwenVoice, resolveSpeakVoice, qwenSpeechPayload, synthesizeSpeech } from "./tts.js";
import {
  canonicalQwenSpeaker,
  isQwenSpeaker,
  looksLikeEdgeVoice,
  parseEdgeVoiceList,
  qwenDefaultForLanguage,
  qwenLanguageName,
  qwenSpeakers,
} from "./tts-voices.js";

function settingsWith(patch: Partial<AppSettings>): AppSettings {
  return Object.assign({}, DEFAULT_APP_SETTINGS, patch);
}

describe("qwen speaker catalog", () => {
  it("lists the nine official CustomVoice speakers", () => {
    const ids = qwenSpeakers().map((voice) => voice.id);
    assert.deepEqual(ids, [
      "Ryan",
      "Aiden",
      "Uncle_Fu",
      "Dylan",
      "Eric",
      "Vivian",
      "Serena",
      "Ono_Anna",
      "Sohee",
    ]);
  });

  it("accepts documented speaker names in either case", () => {
    assert.equal(canonicalQwenSpeaker("Ryan"), "Ryan");
    assert.equal(canonicalQwenSpeaker("ryan"), "Ryan");
    assert.equal(canonicalQwenSpeaker("ono_anna"), "Ono_Anna");
    assert.equal(isQwenSpeaker("Vivian"), true);
    assert.equal(isQwenSpeaker("tr-TR-EmelNeural"), false);
  });

  it("defaults English-native Aiden unless the target is a native Qwen language", () => {
    assert.equal(qwenDefaultForLanguage("tr"), "Aiden");
    assert.equal(qwenDefaultForLanguage("zh"), "Vivian");
    assert.equal(qwenDefaultForLanguage("ja"), "Ono_Anna");
    assert.equal(qwenDefaultForLanguage("ko"), "Sohee");
  });

  it("maps target languages to Qwen language names", () => {
    assert.equal(qwenLanguageName("tr"), "Auto");
    assert.equal(qwenLanguageName("en"), "English");
    assert.equal(qwenLanguageName("zh"), "Chinese");
    assert.equal(qwenLanguageName("de"), "German");
  });
});

describe("edge voice ids", () => {
  it("accepts Microsoft ShortName values only", () => {
    assert.equal(looksLikeEdgeVoice("tr-TR-EmelNeural"), true);
    assert.equal(looksLikeEdgeVoice("en-US-JennyNeural"), true);
    assert.equal(looksLikeEdgeVoice("Ryan"), false);
    assert.equal(looksLikeEdgeVoice("Aiden"), false);
    assert.equal(looksLikeEdgeVoice(""), false);
  });

  it("keeps Neural voices from the live Microsoft list shape", () => {
    const voices = parseEdgeVoiceList([
      {
        ShortName: "tr-TR-EmelNeural",
        FriendlyName: "Microsoft Emel Online (Natural) - Turkish (Turkey)",
        Locale: "tr-TR",
        Gender: "Female",
      },
      {
        ShortName: "tr-TR-AhmetNeural",
        FriendlyName: "Microsoft Ahmet Online (Natural) - Turkish (Turkey)",
        Locale: "tr-TR",
        Gender: "Male",
      },
      {
        ShortName: "en-US-JennyNeural",
        FriendlyName: "Microsoft Jenny Online (Natural) - English (United States)",
        Locale: "en-US",
        Gender: "Female",
      },
      {
        ShortName: "legacy-not-neural",
        FriendlyName: "Skip me",
        Locale: "en-US",
        Gender: "Female",
      },
    ]);
    assert.equal(voices.length, 3);
    assert.equal(voices[0]?.id, "en-US-JennyNeural");
    assert.equal(voices[0]?.gender, "female");
    assert.equal(voices[1]?.id, "tr-TR-AhmetNeural");
    assert.equal(voices[1]?.gender, "male");
    assert.equal(voices[2]?.id, "tr-TR-EmelNeural");
  });
});

describe("resolveSpeakVoice", () => {
  it("never sends Ryan to Microsoft Edge", () => {
    const settings = settingsWith({ ttsEngine: "edge", ttsVoice: "Ryan" });
    assert.equal(resolveSpeakVoice(settings, "tr"), "tr-TR-EmelNeural");
    assert.equal(resolveEdgeVoice(settings, "tr"), "tr-TR-EmelNeural");
  });

  it("keeps Ryan only for the Qwen engine", () => {
    const settings = settingsWith({ ttsEngine: "qwen", ttsVoice: "Ryan" });
    assert.equal(resolveSpeakVoice(settings, "en"), "Ryan");
    assert.equal(resolveQwenVoice(settings), "Ryan");
  });

  it("uses a selected Microsoft neural voice on Edge", () => {
    const settings = settingsWith({ ttsEngine: "edge", ttsVoice: "tr-TR-AhmetNeural" });
    assert.equal(resolveSpeakVoice(settings, "tr"), "tr-TR-AhmetNeural");
  });
});

describe("qwenSpeechPayload", () => {
  it("sends speaker, voice, and language so CustomVoice servers switch timbre", () => {
    const payload = qwenSpeechPayload("Merhaba", "Ryan", "tr");
    assert.equal(payload.model, "tts-1");
    assert.equal(payload.input, "Merhaba");
    assert.equal(payload.voice, "Ryan");
    assert.equal(payload.speaker, "Ryan");
    assert.equal(payload.language, "Auto");
  });

  it("canonicalizes speaker case and maps English", () => {
    const payload = qwenSpeechPayload("Hello", "aiden", "en");
    assert.equal(payload.voice, "Aiden");
    assert.equal(payload.speaker, "Aiden");
    assert.equal(payload.language, "English");
  });
});

describe("synthesizeSpeech qwen failure", () => {
  it("does not fall back to a Microsoft female voice when Qwen is selected", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("nope", { status: 502 });
    try {
      await assert.rejects(
        () =>
          synthesizeSpeech(
            settingsWith({
              ttsEngine: "qwen",
              qwenTtsUrl: "http://127.0.0.1:8880",
              ttsVoice: "Ryan",
            }),
            "hello",
            "en",
          ),
        /Qwen TTS failed/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("parseSettingsInput voice coerce", () => {
  it("replaces Ryan with a Microsoft neural voice when the engine is Edge", () => {
    const parsed = parseSettingsInput(
      Object.assign({}, DEFAULT_APP_SETTINGS, {
        ttsEngine: "edge",
        ttsVoice: "Ryan",
        targetLanguage: "tr",
      }),
    );
    assert.equal(parsed.ttsVoice, "tr-TR-EmelNeural");
  });

  it("keeps Ryan when the engine is Qwen", () => {
    const parsed = parseSettingsInput(
      Object.assign({}, DEFAULT_APP_SETTINGS, {
        ttsEngine: "qwen",
        ttsVoice: "Ryan",
        targetLanguage: "en",
      }),
    );
    assert.equal(parsed.ttsVoice, "Ryan");
  });

  it("lets a draft voice override saved settings without writing them", () => {
    const saved = Object.assign({}, DEFAULT_APP_SETTINGS, {
      ttsEngine: "edge",
      ttsVoice: "tr-TR-EmelNeural",
      targetLanguage: "tr",
    });
    const preview = parseSettingsInput(
      Object.assign({}, saved, { ttsVoice: "tr-TR-AhmetNeural" }),
    );
    assert.equal(preview.ttsVoice, "tr-TR-AhmetNeural");
    assert.equal(saved.ttsVoice, "tr-TR-EmelNeural");
  });
});
