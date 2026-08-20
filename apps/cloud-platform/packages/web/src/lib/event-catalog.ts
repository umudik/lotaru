export const CATALOG_EVENT_TYPES = [
  "clock.tick",
  "file.changed",
  "app.started",
  "github.pull_request.opened",
  "github.pull_request.updated",
  "github.pull_request.merged",
  "voice.intent",
  "note.page.written",
  "agent.ran",
];

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
  if (eventType === "voice.intent") {
    return "Voice intent";
  }
  if (eventType === "note.page.written") {
    return "Note page written";
  }
  if (eventType === "agent.ran") {
    return "Agent ran";
  }
  return eventType;
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
