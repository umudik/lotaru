export const VOICE_RULE_EVENT_PREFIX = "voice.rule.";

export const AGENT_EVENT_PREFIX = "agent.out.";

export const CLOCK_AT_EVENT_PREFIX = "clock.at.";

export const CATALOG_EVENT_TYPES = [
  "clock.every_5s",
  "clock.tick",
  "clock.every_15s",
  "clock.every_30s",
  "clock.every_1m",
  "clock.every_2m",
  "clock.every_5m",
  "clock.every_10m",
  "clock.every_15m",
  "clock.every_30m",
  "clock.every_1h",
  "clock.every_2h",
  "clock.every_3h",
  "clock.every_6h",
  "clock.every_8h",
  "clock.every_12h",
  "clock.every_1d",
  "clock.every_1w",
  "file.changed",
  "app.started",
  "voice.segment.final",
  "voice.batch.scanned",
  "note.book.created",
  "note.page.created",
  "note.page.written",
  "task.created",
  "script.ran",
  "agent.ran",
  "ingest.alarm",
];

const CLOCK_EVENT_LABELS: Record<string, string> = {
  "clock.every_5s": "Every 5 seconds",
  "clock.tick": "Every 10 seconds",
  "clock.every_15s": "Every 15 seconds",
  "clock.every_30s": "Every 30 seconds",
  "clock.every_1m": "Every 1 minute",
  "clock.every_2m": "Every 2 minutes",
  "clock.every_5m": "Every 5 minutes",
  "clock.every_10m": "Every 10 minutes",
  "clock.every_15m": "Every 15 minutes",
  "clock.every_30m": "Every 30 minutes",
  "clock.every_1h": "Every 1 hour",
  "clock.every_2h": "Every 2 hours",
  "clock.every_3h": "Every 3 hours",
  "clock.every_6h": "Every 6 hours",
  "clock.every_8h": "Every 8 hours",
  "clock.every_12h": "Every 12 hours",
  "clock.every_1d": "Every day",
  "clock.every_1w": "Every week",
  "schedule.fired": "Every 10 seconds",
};

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

export function isClockAtEvent(eventType: string): boolean {
  if (eventType.startsWith(CLOCK_AT_EVENT_PREFIX) !== true) {
    return false;
  }
  return eventType.length > CLOCK_AT_EVENT_PREFIX.length;
}

function clockAtCatalogLabel(eventType: string): string {
  if (isClockAtEvent(eventType) !== true) {
    return "";
  }
  const slug = eventType.slice(CLOCK_AT_EVENT_PREFIX.length);
  if (slug.length === 0) {
    return "";
  }
  return slug.replaceAll("-", " ");
}

export function isClockCatalogEvent(eventType: string): boolean {
  if (eventType === "schedule.fired") {
    return true;
  }
  if (eventType.startsWith("clock.") !== true) {
    return false;
  }
  return eventType.length > "clock.".length;
}

export function catalogEventSource(eventType: string): { id: string; label: string } {
  if (isClockCatalogEvent(eventType)) {
    return { id: "clock", label: "Clock" };
  }
  if (isVoiceRuleEvent(eventType)) {
    return { id: "extractor", label: "Extractors" };
  }
  if (isAgentEvent(eventType)) {
    return { id: "responder", label: "Responders" };
  }
  const dot = eventType.indexOf(".");
  if (dot > 0) {
    const prefix = eventType.slice(0, dot);
    if (prefix === "file" || prefix === "app" || prefix === "note" || prefix === "task" || prefix === "script" || prefix === "agent" || prefix === "voice" || prefix === "ingest") {
      return { id: "lotaru", label: "Lotaru" };
    }
    if (prefix === "github") {
      return { id: "github", label: "GitHub" };
    }
    if (prefix === "google") {
      return { id: "google", label: "Google" };
    }
    return { id: prefix, label: prefix };
  }
  return { id: "lotaru", label: "Lotaru" };
}

export function catalogEventLabel(eventType: string): string {
  const clockLabel = CLOCK_EVENT_LABELS[eventType];
  if (clockLabel !== undefined && clockLabel.length > 0) {
    return clockLabel;
  }
  if (eventType === "google.gmail.message.received") {
    return "Gmail message received";
  }
  if (eventType === "google.calendar.event.cancelled") {
    return "Calendar event cancelled";
  }
  if (eventType === "google.calendar.event.created") {
    return "Calendar event created";
  }
  if (eventType === "google.calendar.event.ended") {
    return "Calendar event ended";
  }
  if (eventType === "google.calendar.event.started") {
    return "Calendar event started";
  }
  if (eventType === "google.calendar.event.updated") {
    return "Calendar event updated";
  }
  if (eventType === "google.drive.file.created") {
    return "Drive file created";
  }
  if (eventType === "google.drive.file.updated") {
    return "Drive file updated";
  }
  if (eventType === "google.drive.folder.created") {
    return "Drive folder created";
  }
  if (eventType === "google.drive.folder.updated") {
    return "Drive folder updated";
  }
  if (eventType === "google.drive.folder.watch.updated") {
    return "Drive watched folder updated";
  }
  if (eventType === "outlook.message.received") {
    return "Outlook message received";
  }
  if (eventType === "notion.page.added") {
    return "Page added to database";
  }
  if (eventType === "notion.page.updated") {
    return "Page updated in database";
  }
  if (eventType === "jira.issue.created") {
    return "Issue created";
  }
  if (eventType === "github.pull_request.opened") {
    return "Pull request opened";
  }
  if (eventType === "github.pull_request.updated") {
    return "Pull request updated";
  }
  if (eventType === "github.pull_request.merged") {
    return "Pull request merged";
  }
  if (eventType === "github.installation") {
    return "App installed";
  }
  if (eventType === "github.installation_repositories") {
    return "App repositories changed";
  }
  if (eventType === "github.create") {
    return "Branch or tag created";
  }
  if (eventType === "github.delete") {
    return "Branch or tag deleted";
  }
  if (eventType === "github.gollum") {
    return "Wiki page updated";
  }
  if (eventType === "github.public") {
    return "Repository made public";
  }
  if (eventType === "github.watch") {
    return "Repository watched";
  }
  if (eventType === "github.meta") {
    return "Webhook ping";
  }
  if (eventType === "file.changed") {
    return "File saved";
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
  if (eventType === "ingest.alarm") {
    return "Catch-up alarm";
  }
  if (isVoiceRuleEvent(eventType)) {
    return `Rule: ${voiceRuleSlug(eventType)}`;
  }
  if (isAgentEvent(eventType)) {
    return `Agent: ${agentEventSlug(eventType)}`;
  }
  const atLabel = clockAtCatalogLabel(eventType);
  if (atLabel.length > 0) {
    return atLabel;
  }
  return eventType;
}

export function eventLabelWithRules(
  eventType: string,
  mintedLabels: Record<string, string>,
): string {
  const name = mintedLabels[eventType];
  if (name !== undefined && name.length > 0) {
    if (isAgentEvent(eventType)) {
      return `Agent: ${name}`;
    }
    if (isVoiceRuleEvent(eventType)) {
      return `Rule: ${name}`;
    }
    return name;
  }
  return catalogEventLabel(eventType);
}
