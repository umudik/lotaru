import { relative } from "node:path";
import micromatch from "micromatch";
import { SLUG_PATTERN } from "./slug.js";
import { connectorEventTypes } from "./connector-catalog.js";
import { calendarHitsNow, parseCalendarCron } from "./calendar-schedule.js";

export const EVENT_CLOCK_TICK = "clock.tick";
export const EVENT_CLOCK_EVERY_1M = "clock.every_1m";
export const EVENT_FILE_CHANGED = "file.changed";
export const EVENT_APP_STARTED = "app.started";
export const EVENT_GITHUB_PR_OPENED = "github.pull_request.opened";
export const EVENT_GITHUB_PR_UPDATED = "github.pull_request.updated";
export const EVENT_GITHUB_PR_MERGED = "github.pull_request.merged";
export const EVENT_GMAIL_MESSAGE_RECEIVED = "google.gmail.message.received";
export const EVENT_OUTLOOK_MESSAGE_RECEIVED = "outlook.message.received";
export const EVENT_NOTION_PAGE_ADDED = "notion.page.added";
export const EVENT_JIRA_ISSUE_CREATED = "jira.issue.created";
export const EVENT_VOICE_SEGMENT = "voice.segment.final";
export const EVENT_VOICE_BATCH = "voice.batch.scanned";
export const EVENT_NOTE_BOOK_CREATED = "note.book.created";
export const EVENT_NOTE_PAGE_CREATED = "note.page.created";
export const EVENT_NOTE_PAGE_WRITTEN = "note.page.written";
export const EVENT_TASK_CREATED = "task.created";
export const EVENT_SCRIPT_RAN = "script.ran";
export const EVENT_AGENT_RAN = "agent.ran";
export const EVENT_INGEST_ALARM = "ingest.alarm";

export const CLOCK_TICK_MS = 5000;

export const CLOCK_INTERVAL_TYPES = [
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
] as const;

export type ClockIntervalType = (typeof CLOCK_INTERVAL_TYPES)[number];

export type ClockInterval = {
  type: ClockIntervalType;
  ms: number;
  label: string;
};

export const CLOCK_INTERVALS: readonly ClockInterval[] = [
  { type: "clock.every_5s", ms: 5_000, label: "Every 5 seconds" },
  { type: "clock.tick", ms: 10_000, label: "Every 10 seconds" },
  { type: "clock.every_15s", ms: 15_000, label: "Every 15 seconds" },
  { type: "clock.every_30s", ms: 30_000, label: "Every 30 seconds" },
  { type: "clock.every_1m", ms: 60_000, label: "Every 1 minute" },
  { type: "clock.every_2m", ms: 120_000, label: "Every 2 minutes" },
  { type: "clock.every_5m", ms: 300_000, label: "Every 5 minutes" },
  { type: "clock.every_10m", ms: 600_000, label: "Every 10 minutes" },
  { type: "clock.every_15m", ms: 900_000, label: "Every 15 minutes" },
  { type: "clock.every_30m", ms: 1_800_000, label: "Every 30 minutes" },
  { type: "clock.every_1h", ms: 3_600_000, label: "Every 1 hour" },
  { type: "clock.every_2h", ms: 7_200_000, label: "Every 2 hours" },
  { type: "clock.every_3h", ms: 10_800_000, label: "Every 3 hours" },
  { type: "clock.every_6h", ms: 21_600_000, label: "Every 6 hours" },
  { type: "clock.every_8h", ms: 28_800_000, label: "Every 8 hours" },
  { type: "clock.every_12h", ms: 43_200_000, label: "Every 12 hours" },
  { type: "clock.every_1d", ms: 86_400_000, label: "Every day" },
  { type: "clock.every_1w", ms: 604_800_000, label: "Every week" },
];

export const BUS_EVENT_TYPES = [
  ...CLOCK_INTERVAL_TYPES,
  EVENT_FILE_CHANGED,
  EVENT_APP_STARTED,
  EVENT_VOICE_SEGMENT,
  EVENT_VOICE_BATCH,
  EVENT_NOTE_BOOK_CREATED,
  EVENT_NOTE_PAGE_CREATED,
  EVENT_NOTE_PAGE_WRITTEN,
  EVENT_TASK_CREATED,
  EVENT_SCRIPT_RAN,
  EVENT_AGENT_RAN,
  EVENT_INGEST_ALARM,
];

export type LotaruEvent = {
  id: string;
  type: string;
  projectId: string;
  scriptId: string;
  path: string;
  detail: string;
  createdAt: number;
};

export type EventListenerScript = {
  id: string;
  projectId: string;
  triggerType: string;
  triggerGlob: string;
  triggerBusEvent: string;
  triggerCron: string;
  enabled: boolean;
};

export function canonicalBusEventType(type: string): string {
  if (type === "schedule.fired") {
    return EVENT_CLOCK_TICK;
  }
  if (type === EVENT_NOTE_PAGE_WRITTEN) {
    return EVENT_NOTE_PAGE_CREATED;
  }
  return type;
}

export function isBusEventType(type: string): boolean {
  const canonical = canonicalBusEventType(type);
  if (isMintedEventType(canonical)) {
    return true;
  }
  for (const known of BUS_EVENT_TYPES) {
    if (known === canonical) {
      return true;
    }
  }
  for (const known of connectorEventTypes()) {
    if (known === canonical) {
      return true;
    }
  }
  return false;
}

export const VOICE_RULE_EVENT_PREFIX = "voice.rule.";

/**
 * An agent that writes back to the bus mints one of these from its own slug, so
 * "agent.ran" stays the platform's own record of a run and this stays the
 * agent's deliberate output that other subscribers can wire themselves to.
 */
export const AGENT_EVENT_PREFIX = "agent.out.";

export const CLOCK_AT_EVENT_PREFIX = "clock.at.";

export function ruleEventType(slug: string): string {
  return `${VOICE_RULE_EVENT_PREFIX}${slug}`;
}

export function ruleEventSlug(eventType: string): string {
  if (eventType.startsWith(VOICE_RULE_EVENT_PREFIX) !== true) {
    return "";
  }
  const slug = eventType.slice(VOICE_RULE_EVENT_PREFIX.length);
  if (SLUG_PATTERN.test(slug) !== true) {
    return "";
  }
  return slug;
}

export function isRuleEventType(eventType: string): boolean {
  return ruleEventSlug(eventType).length > 0;
}

export function agentEventType(slug: string): string {
  return `${AGENT_EVENT_PREFIX}${slug}`;
}

export function agentEventSlug(eventType: string): string {
  if (eventType.startsWith(AGENT_EVENT_PREFIX) !== true) {
    return "";
  }
  const slug = eventType.slice(AGENT_EVENT_PREFIX.length);
  if (SLUG_PATTERN.test(slug) !== true) {
    return "";
  }
  return slug;
}

export function isAgentEventType(eventType: string): boolean {
  return agentEventSlug(eventType).length > 0;
}

export function clockAtEventType(slug: string): string {
  return `${CLOCK_AT_EVENT_PREFIX}${slug}`;
}

export function clockAtEventSlug(eventType: string): string {
  if (eventType.startsWith(CLOCK_AT_EVENT_PREFIX) !== true) {
    return "";
  }
  const slug = eventType.slice(CLOCK_AT_EVENT_PREFIX.length);
  if (SLUG_PATTERN.test(slug) !== true) {
    return "";
  }
  return slug;
}

export function isClockAtEventType(eventType: string): boolean {
  return clockAtEventSlug(eventType).length > 0;
}

export function isMintedEventType(eventType: string): boolean {
  if (isRuleEventType(eventType)) {
    return true;
  }
  if (isAgentEventType(eventType)) {
    return true;
  }
  return isClockAtEventType(eventType);
}

export function listenTypesForTriggerKind(trigger: string): readonly string[] {
  if (trigger === "scheduled") {
    return [EVENT_CLOCK_TICK];
  }
  if (trigger === "schedule") {
    return [EVENT_CLOCK_TICK];
  }
  if (trigger === "save") {
    return [EVENT_FILE_CHANGED];
  }
  if (trigger === "startup") {
    return [EVENT_APP_STARTED];
  }
  return [];
}

export function isClockEventType(type: string): boolean {
  const canonical = canonicalBusEventType(type);
  for (const listed of CLOCK_INTERVAL_TYPES) {
    if (listed === canonical) {
      return true;
    }
  }
  return false;
}

export function clockIntervalLabel(type: string): string {
  const canonical = canonicalBusEventType(type);
  for (const interval of CLOCK_INTERVALS) {
    if (interval.type !== canonical) {
      continue;
    }
    if (interval.label.length === 0) {
      return canonical;
    }
    return interval.label;
  }
  return canonical;
}

export function clockTypesDue(nowMs: number, prevMs: number): readonly ClockIntervalType[] {
  if (Number.isFinite(nowMs) !== true) {
    return [];
  }
  if (nowMs < 0) {
    return [];
  }
  if (prevMs <= 0) {
    return [EVENT_CLOCK_TICK];
  }
  if (Number.isFinite(prevMs) !== true) {
    return [];
  }
  if (nowMs <= prevMs) {
    return [];
  }
  const due: ClockIntervalType[] = [];
  for (const interval of CLOCK_INTERVALS) {
    const nowBucket = Math.floor(nowMs / interval.ms);
    const prevBucket = Math.floor(prevMs / interval.ms);
    if (nowBucket !== prevBucket) {
      due.push(interval.type);
    }
  }
  return due;
}

export function subscriptionBusTypes(kind: string, namedEvent: string): readonly string[] {
  if (kind === "event") {
    const trimmed = namedEvent.trim();
    if (trimmed.length === 0) {
      return [];
    }
    const canonical = canonicalBusEventType(trimmed);
    if (isBusEventType(canonical) !== true) {
      return [];
    }
    return [canonical];
  }
  if (kind === "scheduled" || kind === "schedule") {
    const trimmed = namedEvent.trim();
    if (trimmed.length > 0) {
      const canonical = canonicalBusEventType(trimmed);
      if (isClockEventType(canonical)) {
        return [canonical];
      }
      if (isClockAtEventType(canonical)) {
        return [canonical];
      }
    }
    return [EVENT_CLOCK_TICK];
  }
  return listenTypesForTriggerKind(kind);
}

export function relativeWatchPath(root: string, filePath: string): string {
  if (root.length === 0 || filePath.length === 0) {
    return "";
  }
  const rel = relative(root, filePath);
  if (rel.length === 0) {
    return "";
  }
  if (rel.startsWith("..")) {
    return "";
  }
  return rel.replaceAll("\\", "/");
}

export function watchPathMatchesGlob(relPath: string, glob: string): boolean {
  if (relPath.length === 0) {
    return false;
  }
  if (glob.length === 0) {
    return true;
  }
  const posixGlob = glob.replaceAll("\\", "/");
  return micromatch.isMatch(relPath, posixGlob);
}

export function scriptListensToEvent(script: EventListenerScript, event: LotaruEvent): boolean {
  if (script.enabled !== true) {
    return false;
  }
  if (script.projectId !== event.projectId) {
    return false;
  }
  const eventType = canonicalBusEventType(event.type);
  // A script finishing publishes script.ran. Letting it hear its own would spin
  // forever, so a script never listens to itself.
  if (eventType === EVENT_SCRIPT_RAN && event.scriptId === script.id) {
    return false;
  }
  if (script.triggerType === "event") {
    const wanted = subscriptionBusTypes("event", script.triggerBusEvent);
    for (const listenType of wanted) {
      if (listenType === eventType) {
        return true;
      }
    }
    return false;
  }
  const listenTypes = subscriptionBusTypes(script.triggerType, script.triggerBusEvent);
  let matched = false;
  for (const listenType of listenTypes) {
    if (listenType === eventType) {
      matched = true;
    }
  }
  if (matched !== true) {
    return false;
  }
  if (script.triggerCron.trim().length > 0) {
    if (eventType !== EVENT_CLOCK_EVERY_1M) {
      return false;
    }
    try {
      const spec = parseCalendarCron(script.triggerCron);
      return calendarHitsNow(spec, new Date(event.createdAt));
    } catch {
      return false;
    }
  }
  if (event.scriptId.length > 0 && event.scriptId !== script.id) {
    return false;
  }
  if (eventType !== EVENT_FILE_CHANGED) {
    return true;
  }
  return watchPathMatchesGlob(event.path, script.triggerGlob);
}

export function eventRunReason(event: LotaruEvent): string {
  const eventType = canonicalBusEventType(event.type);
  if (isClockEventType(eventType)) {
    return "clock";
  }
  if (isClockAtEventType(eventType)) {
    return "clock";
  }
  if (eventType === EVENT_APP_STARTED) {
    if (event.detail.length === 0) {
      return "startup:boot";
    }
    return `startup:${event.detail}`;
  }
  if (eventType === EVENT_FILE_CHANGED) {
    if (event.path.length === 0) {
      return "save";
    }
    return `save:${event.path}`;
  }
  if (eventType === EVENT_SCRIPT_RAN) {
    if (event.path.length === 0) {
      return EVENT_SCRIPT_RAN;
    }
    return `${EVENT_SCRIPT_RAN}:${event.path}`;
  }
  if (eventType === EVENT_TASK_CREATED) {
    if (event.path.length === 0) {
      return EVENT_TASK_CREATED;
    }
    return `${EVENT_TASK_CREATED}:${event.path}`;
  }
  if (eventType === EVENT_NOTE_PAGE_CREATED) {
    if (event.path.length === 0) {
      return EVENT_NOTE_PAGE_CREATED;
    }
    return `${EVENT_NOTE_PAGE_CREATED}:${event.path}`;
  }
  if (eventType === EVENT_VOICE_SEGMENT) {
    return EVENT_VOICE_SEGMENT;
  }
  if (eventType === EVENT_VOICE_BATCH) {
    return EVENT_VOICE_BATCH;
  }
  if (eventType === EVENT_INGEST_ALARM) {
    if (event.path.length === 0) {
      return EVENT_INGEST_ALARM;
    }
    return `${EVENT_INGEST_ALARM}:${event.path}`;
  }
  if (event.detail.length === 0) {
    return eventType;
  }
  return `${eventType}:${event.detail}`;
}
