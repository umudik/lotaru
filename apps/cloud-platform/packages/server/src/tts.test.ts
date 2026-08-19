import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_APP_SETTINGS, parseSettingsInput, type AppSettings } from "./app-settings.js";
import { resolveEdgeVoice, resolveQwenVoice, resolveSpeakVoice } from "./tts.js";
import {
  canonicalQwenSpeaker,
  isQwenSpeaker,
  looksLikeEdgeVoice,
  parseEdgeVoiceList,
  qwenDefaultForLanguage,
  qwenSpeakers,
} from "./tts-voices.js";

function settingsWith(patch: Partial<AppSettings>): AppSettings {
  return Object.assign({}, DEFAULT_APP_SETTINGS, patch);
}

describe("qwen speaker catalog", () => {
  it("lists the nine official CustomVoice speakers", () => {
    const ids = qwenSpeakers().map((voice) => voice.id);
    assert.deepEqual(ids, [
      "Vivian",
      "Serena",
      "Uncle_Fu",
      "Dylan",
      "Eric",
      "Ryan",
      "Aiden",
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
    assert.equal(voices[1]?.id, "tr-TR-AhmetNeural");
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
