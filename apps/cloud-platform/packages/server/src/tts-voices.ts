import { z } from "zod";
import { listVoices } from "edge-tts-universal";
import { TARGET_LANGUAGES, edgeVoiceForLanguage } from "./note-language.js";

export type TtsVoiceOption = {
  id: string;
  label: string;
  locale: string;
};

type QwenSpeaker = {
  id: string;
  label: string;
  locale: string;
};

export const QWEN_SPEAKERS: readonly QwenSpeaker[] = [
  { id: "Vivian", label: "Vivian — Chinese · bright young female", locale: "zh" },
  { id: "Serena", label: "Serena — Chinese · warm young female", locale: "zh" },
  { id: "Uncle_Fu", label: "Uncle_Fu — Chinese · seasoned male", locale: "zh" },
  { id: "Dylan", label: "Dylan — Chinese (Beijing) · youthful male", locale: "zh" },
  { id: "Eric", label: "Eric — Chinese (Sichuan) · lively male", locale: "zh" },
  { id: "Ryan", label: "Ryan — English · dynamic male", locale: "en" },
  { id: "Aiden", label: "Aiden — English · sunny American male", locale: "en" },
  { id: "Ono_Anna", label: "Ono_Anna — Japanese · playful female", locale: "ja" },
  { id: "Sohee", label: "Sohee — Korean · warm female", locale: "ko" },
];

const edgeVoiceSchema = z.object({
  ShortName: z.string().min(1),
  FriendlyName: z.string(),
  Locale: z.string().min(1),
  Gender: z.string(),
});

let edgeVoiceCache: { at: number; voices: TtsVoiceOption[] } | undefined;
const EDGE_VOICE_TTL_MS = 60 * 60 * 1000;

function normalizeSpeakerKey(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "_");
}

export function qwenSpeakers(): TtsVoiceOption[] {
  const voices: TtsVoiceOption[] = [];
  for (const speaker of QWEN_SPEAKERS) {
    voices.push({
      id: speaker.id,
      label: speaker.label,
      locale: speaker.locale,
    });
  }
  return voices;
}

export function canonicalQwenSpeaker(value: string): string {
  const key = normalizeSpeakerKey(value);
  for (const speaker of QWEN_SPEAKERS) {
    if (normalizeSpeakerKey(speaker.id) === key) {
      return speaker.id;
    }
  }
  return "";
}

export function isQwenSpeaker(value: string): boolean {
  return canonicalQwenSpeaker(value).length > 0;
}

export function looksLikeEdgeVoice(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 8) {
    return false;
  }
  if (!trimmed.includes("-")) {
    return false;
  }
  return trimmed.endsWith("Neural");
}

export function qwenDefaultForLanguage(language: string): string {
  if (language === "zh") {
    return "Vivian";
  }
  if (language === "ja") {
    return "Ono_Anna";
  }
  if (language === "ko") {
    return "Sohee";
  }
  return "Aiden";
}

export function fallbackEdgeVoices(): TtsVoiceOption[] {
  const voices: TtsVoiceOption[] = [];
  const seen = new Set<string>();
  for (const lang of TARGET_LANGUAGES) {
    const id = edgeVoiceForLanguage(lang.id);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    voices.push({
      id,
      label: `${lang.label} · ${id}`,
      locale: lang.id,
    });
  }
  return voices;
}

export function parseEdgeVoiceList(raw: unknown): TtsVoiceOption[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const voices: TtsVoiceOption[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const parsed = edgeVoiceSchema.safeParse(entry);
    if (!parsed.success) {
      continue;
    }
    const shortName = parsed.data.ShortName.trim();
    if (!shortName.endsWith("Neural")) {
      continue;
    }
    if (seen.has(shortName)) {
      continue;
    }
    seen.add(shortName);
    const friendly = parsed.data.FriendlyName.trim();
    const locale = parsed.data.Locale.trim();
    const gender = parsed.data.Gender.trim();
    let label = shortName;
    if (friendly.length > 0) {
      label = `${friendly} · ${gender}`;
    }
    voices.push({
      id: shortName,
      label,
      locale,
    });
  }
  const sorted = voices.slice();
  sorted.sort((left, right) => {
    const localeOrder = left.locale.localeCompare(right.locale);
    if (localeOrder !== 0) {
      return localeOrder;
    }
    return left.id.localeCompare(right.id);
  });
  return sorted;
}

export async function listEdgeVoices(): Promise<TtsVoiceOption[]> {
  const now = Date.now();
  if (edgeVoiceCache !== undefined && now - edgeVoiceCache.at < EDGE_VOICE_TTL_MS) {
    return edgeVoiceCache.voices;
  }
  try {
    const listed = await listVoices();
    const voices = parseEdgeVoiceList(listed);
    if (voices.length === 0) {
      return fallbackEdgeVoices();
    }
    edgeVoiceCache = { at: now, voices };
    return voices;
  } catch {
    return fallbackEdgeVoices();
  }
}

export async function voicesForEngine(engine: "edge" | "qwen"): Promise<TtsVoiceOption[]> {
  if (engine === "qwen") {
    return qwenSpeakers();
  }
  return listEdgeVoices();
}
