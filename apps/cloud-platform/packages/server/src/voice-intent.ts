import { z } from "zod";

export const voiceIntentDecisionSchema = z.object({
  emit: z.boolean(),
  title: z.string().trim(),
  summary: z.string().trim(),
  reason: z.string().trim(),
});

export type VoiceIntentDecision = z.infer<typeof voiceIntentDecisionSchema>;

export function voiceIntentScannerPrompt(input: {
  rollingTranscript: string;
  latestUtterance: string;
}): string {
  const lines = [
    "You decide whether a spoken utterance should become a Lotaru bus event.",
    "Return JSON only with keys: emit (boolean), title (string), summary (string), reason (string).",
    "emit=true only when the speaker clearly commits an actionable intent (task, request, decision, instruction).",
    "emit=false for greetings, filler, unfinished thoughts, or mid-conversation without a clear ask.",
    "Do not use silence; use only the text and context.",
    "Rolling transcript:",
    input.rollingTranscript,
    "Latest utterance:",
    input.latestUtterance,
  ];
  return lines.join("\n");
}

export function parseVoiceIntentDecision(raw: string): VoiceIntentDecision[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return [];
  }
  let jsonText = trimmed;
  const fenceStart = trimmed.indexOf("```");
  if (fenceStart >= 0) {
    const afterFence = trimmed.slice(fenceStart + 3);
    const newline = afterFence.indexOf("\n");
    let body = afterFence;
    if (newline >= 0) {
      body = afterFence.slice(newline + 1);
    }
    const fenceEnd = body.indexOf("```");
    if (fenceEnd >= 0) {
      body = body.slice(0, fenceEnd);
    }
    jsonText = body.trim();
  }
  const braceStart = jsonText.indexOf("{");
  const braceEnd = jsonText.lastIndexOf("}");
  if (braceStart < 0 || braceEnd <= braceStart) {
    return [];
  }
  const slice = jsonText.slice(braceStart, braceEnd + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return [];
  }
  const checked = voiceIntentDecisionSchema.safeParse(parsed);
  if (checked.success !== true) {
    return [];
  }
  return [checked.data];
}
