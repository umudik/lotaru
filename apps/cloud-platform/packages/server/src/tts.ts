import { EdgeTTS } from "edge-tts-universal";
import type { AppSettings } from "./app-settings.js";
import { edgeVoiceForLanguage } from "./note-language.js";
import { canonicalQwenSpeaker, looksLikeEdgeVoice, qwenDefaultForLanguage } from "./tts-voices.js";

function trimHost(host: string): string {
  return host.trim().replace(/\/$/, "");
}

async function blobToBuffer(blob: Blob): Promise<Buffer> {
  const bytes = await blob.arrayBuffer();
  return Buffer.from(bytes);
}

async function synthesizeEdge(text: string, voice: string): Promise<Buffer> {
  if (!looksLikeEdgeVoice(voice)) {
    throw new Error(`Invalid Microsoft voice '${voice}'`);
  }
  const tts = new EdgeTTS(text, voice);
  const result = await tts.synthesize();
  return blobToBuffer(result.audio);
}

async function synthesizeQwen(url: string, text: string, voice: string): Promise<Buffer> {
  const endpoint = `${trimHost(url)}/v1/audio/speech`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "tts-1",
      input: text,
      voice,
    }),
  });
  if (!res.ok) {
    throw new Error(`Qwen TTS failed (${String(res.status)})`);
  }
  const bytes = await res.arrayBuffer();
  return Buffer.from(bytes);
}

export function resolveEdgeVoice(settings: AppSettings, language: string): string {
  if (looksLikeEdgeVoice(settings.ttsVoice)) {
    return settings.ttsVoice.trim();
  }
  return edgeVoiceForLanguage(language);
}

export function resolveQwenVoice(settings: AppSettings): string {
  const canonical = canonicalQwenSpeaker(settings.ttsVoice);
  if (canonical.length > 0) {
    return canonical;
  }
  return qwenDefaultForLanguage(settings.targetLanguage);
}

export function resolveSpeakVoice(settings: AppSettings, language: string): string {
  if (settings.ttsEngine === "qwen") {
    return resolveQwenVoice(settings);
  }
  return resolveEdgeVoice(settings, language);
}

export async function synthesizeSpeech(settings: AppSettings, text: string, language: string): Promise<Buffer> {
  const spoken = text.trim();
  if (spoken.length === 0) {
    throw new Error("Nothing to read");
  }
  const clipped = spoken.slice(0, 4000);
  const qwenUrl = settings.qwenTtsUrl.trim();
  if (settings.ttsEngine === "qwen" && qwenUrl.length > 0) {
    try {
      return await synthesizeQwen(qwenUrl, clipped, resolveQwenVoice(settings));
    } catch {
      return synthesizeEdge(clipped, edgeVoiceForLanguage(language));
    }
  }
  return synthesizeEdge(clipped, resolveEdgeVoice(settings, language));
}
