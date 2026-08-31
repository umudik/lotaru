import { z } from "zod";
import { ruleEventType } from "./events.js";
import { slugifyName } from "./slug.js";

export type VoiceRule = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  instruction: string;
  enabled: boolean;
  createdAt: string;
  createdBy: string;
};

export type VoiceRuleMatch = {
  slug: string;
  title: string;
  summary: string;
  quote: string;
};

export const VOICE_RULE_SYSTEM =
  "You match spoken transcript lines against named rules. Reply with JSON only.";

/** Rules keep their own name for the shared slug folding. */
export function slugifyRuleName(name: string): string {
  return slugifyName(name);
}

export function ruleEventTypeFor(rule: Pick<VoiceRule, "slug">): string {
  return ruleEventType(rule.slug);
}

const matchSchema = z.object({
  rule: z.string().trim(),
  title: z.string().trim(),
  summary: z.string().trim(),
  quote: z.string().trim(),
});

const matchesSchema = z.object({
  matches: z.array(matchSchema),
});

export function voiceRulePrompt(input: {
  transcript: string;
  rules: readonly Pick<VoiceRule, "slug" | "name" | "instruction">[];
}): string {
  const lines: string[] = [
    "You read a transcript of what someone said out loud and decide which of the rules below it triggers.",
    "The transcript can be in any language. Do not translate it; keep the speaker's own words in title, summary, and quote.",
    "",
    "Rules:",
  ];
  for (const rule of input.rules) {
    lines.push(`- id "${rule.slug}" (${rule.name}): ${rule.instruction}`);
  }
  lines.push(
    "",
    'Return JSON only: { "matches": [ { "rule": "<rule id>", "title": "<short label>", "summary": "<what the speaker asked for>", "quote": "<the transcript line that triggered it>" } ] }',
    "One entry per distinct thing the speaker asked for. The same rule may appear more than once for different asks.",
    'Return { "matches": [] } when nothing in the transcript matches a rule.',
    "Never invent an ask. Skip greetings, filler, thinking out loud, and unfinished sentences.",
    "",
    "Transcript:",
    input.transcript,
  );
  return lines.join("\n");
}

function jsonBody(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "";
  }
  let text = trimmed;
  const fenceStart = text.indexOf("```");
  if (fenceStart >= 0) {
    const afterFence = text.slice(fenceStart + 3);
    const newline = afterFence.indexOf("\n");
    let body = afterFence;
    if (newline >= 0) {
      body = afterFence.slice(newline + 1);
    }
    const fenceEnd = body.indexOf("```");
    if (fenceEnd >= 0) {
      body = body.slice(0, fenceEnd);
    }
    text = body.trim();
  }
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart < 0 || braceEnd <= braceStart) {
    return "";
  }
  return text.slice(braceStart, braceEnd + 1);
}

export function parseVoiceRuleMatches(
  raw: string,
  rules: readonly Pick<VoiceRule, "slug" | "name">[],
): VoiceRuleMatch[] {
  const body = jsonBody(raw);
  if (body.length === 0) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const checked = matchesSchema.safeParse(parsed);
  if (checked.success !== true) {
    return [];
  }
  const matches: VoiceRuleMatch[] = [];
  for (const entry of checked.data.matches) {
    const slug = resolveRuleSlug(entry.rule, rules);
    if (slug.length === 0) {
      continue;
    }
    if (entry.summary.length === 0 && entry.title.length === 0) {
      continue;
    }
    matches.push({
      slug,
      title: entry.title.slice(0, 200),
      summary: entry.summary.slice(0, 2000),
      quote: entry.quote.slice(0, 500),
    });
  }
  return matches;
}

function resolveRuleSlug(
  candidate: string,
  rules: readonly Pick<VoiceRule, "slug" | "name">[],
): string {
  const needle = candidate.trim().toLowerCase();
  if (needle.length === 0) {
    return "";
  }
  for (const rule of rules) {
    if (rule.slug.toLowerCase() === needle) {
      return rule.slug;
    }
  }
  for (const rule of rules) {
    if (rule.name.trim().toLowerCase() === needle) {
      return rule.slug;
    }
  }
  return "";
}

