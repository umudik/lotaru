export const VOICE_RULE_EVENT_PREFIX = "voice.rule.";

export const AGENT_EVENT_PREFIX = "agent.out.";

export const CATALOG_EVENT_TYPES = [
  "clock.tick",
  "file.changed",
  "app.started",
  "github.pull_request.opened",
  "github.pull_request.updated",
  "github.pull_request.merged",
  "voice.segment.final",
  "voice.batch.scanned",
  "note.book.created",
  "note.page.created",
  "note.page.written",
  "task.created",
  "script.ran",
  "agent.ran",
];

export function isVoiceRuleEvent(eventType: string): boolean {
  return eventType.startsWith(VOICE_RULE_EVENT_PREFIX);
}

export function voiceRuleSlug(eventType: string): string {
  if (isVoiceRuleEvent(eventType) !== true) {
    return "";
  }
  return eventType.slice(VOICE_RULE_EVENT_PREFIX.length);
}

export function isAgentEvent(eventType: string): boolean {
  return eventType.startsWith(AGENT_EVENT_PREFIX);
}

export function agentEventSlug(eventType: string): string {
  if (isAgentEvent(eventType) !== true) {
    return "";
  }
  return eventType.slice(AGENT_EVENT_PREFIX.length);
}

export function catalogEventLabel(eventType: string): string {
  if (eventType === "github.pull_request.opened") {
    return "Pull request opened";
  }
  if (eventType === "github.pull_request.updated") {
    return "Pull request updated";
  }
  if (eventType === "github.pull_request.merged") {
    return "Pull request merged";
  }
  if (eventType === "file.changed") {
    return "File saved";
  }
  if (eventType === "clock.tick") {
    return "Clock (every 10s)";
  }
  if (eventType === "schedule.fired") {
    return "Clock (every 10s)";
  }
  if (eventType === "app.started") {
    return "App started";
  }
  if (eventType === "voice.segment.final") {
    return "Voice line transcribed";
  }
  if (eventType === "voice.batch.scanned") {
    return "Voice scan finished";
  }
  if (eventType === "voice.intent") {
    return "Voice intent (retired)";
  }
  if (eventType === "note.book.created") {
    return "Note book created";
  }
  if (eventType === "note.page.created" || eventType === "note.page.written") {
    return "Note page created";
  }
  if (eventType === "task.created") {
    return "Task created";
  }
  if (eventType === "script.ran") {
    return "Script finished";
  }
  if (eventType === "agent.ran") {
    return "Agent ran";
  }
  if (isVoiceRuleEvent(eventType)) {
    return `Rule: ${voiceRuleSlug(eventType)}`;
  }
  if (isAgentEvent(eventType)) {
    return `Agent: ${agentEventSlug(eventType)}`;
  }
  return eventType;
}

/**
 * Rules and bus-writing agents are named by the user, so a minted event's label
 * comes from the server when we have it and falls back to the slug when we do
 * not.
 */
export function eventLabelWithRules(
  eventType: string,
  mintedLabels: Record<string, string>,
): string {
  const name = mintedLabels[eventType];
  if (name !== undefined && name.length > 0) {
    if (isAgentEvent(eventType)) {
      return `Agent: ${name}`;
    }
    return `Rule: ${name}`;
  }
  return catalogEventLabel(eventType);
}

export function isClockCatalogEvent(eventType: string): boolean {
  if (eventType === "clock.tick") {
    return true;
  }
  if (eventType === "schedule.fired") {
    return true;
  }
  return false;
}
