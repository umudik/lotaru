import { relative } from "node:path";
import micromatch from "micromatch";
import { SLUG_PATTERN } from "./slug.js";

export const EVENT_CLOCK_TICK = "clock.tick";
export const EVENT_FILE_CHANGED = "file.changed";
export const EVENT_APP_STARTED = "app.started";
export const EVENT_GITHUB_PR_OPENED = "github.pull_request.opened";
export const EVENT_GITHUB_PR_UPDATED = "github.pull_request.updated";
export const EVENT_GITHUB_PR_MERGED = "github.pull_request.merged";
export const EVENT_VOICE_SEGMENT = "voice.segment.final";
export const EVENT_VOICE_BATCH = "voice.batch.scanned";
export const EVENT_NOTE_BOOK_CREATED = "note.book.created";
export const EVENT_NOTE_PAGE_CREATED = "note.page.created";
export const EVENT_NOTE_PAGE_WRITTEN = "note.page.written";
export const EVENT_TASK_CREATED = "task.created";
export const EVENT_SCRIPT_RAN = "script.ran";
export const EVENT_AGENT_RAN = "agent.ran";

export const CLOCK_TICK_MS = 10000;

export const BUS_EVENT_TYPES = [
  EVENT_CLOCK_TICK,
  EVENT_FILE_CHANGED,
  EVENT_APP_STARTED,
  EVENT_GITHUB_PR_OPENED,
  EVENT_GITHUB_PR_UPDATED,
  EVENT_GITHUB_PR_MERGED,
  EVENT_VOICE_SEGMENT,
  EVENT_VOICE_BATCH,
  EVENT_NOTE_BOOK_CREATED,
  EVENT_NOTE_PAGE_CREATED,
  EVENT_NOTE_PAGE_WRITTEN,
  EVENT_TASK_CREATED,
  EVENT_SCRIPT_RAN,
  EVENT_AGENT_RAN,
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
  enabled: boolean;
};

export function canonicalBusEventType(type: string): string {
  if (type === "schedule.fired") {
    return EVENT_CLOCK_TICK;
  }
  if (type === "manual") {
    return "";
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
  return false;
}

export const VOICE_RULE_EVENT_PREFIX = "voice.rule.";

/**
 * An agent that writes back to the bus mints one of these from its own slug, so
 * "agent.ran" stays the platform's own record of a run and this stays the
 * agent's deliberate output that other subscribers can wire themselves to.
 */
export const AGENT_EVENT_PREFIX = "agent.out.";

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

/** Every event type a feature mints at runtime rather than the platform naming up front. */
export function isMintedEventType(eventType: string): boolean {
  if (isRuleEventType(eventType)) {
    return true;
  }
  return isAgentEventType(eventType);
}

export type ReplayEmit = {
  type: string;
  projectId: string;
  scriptId: string;
  path: string;
  detail: string;
};

export function replayPayloadsFromStored(stored: LotaruEvent): ReplayEmit[] {
  const type = canonicalBusEventType(stored.type);
  if (type.length === 0) {
    return [];
  }
  if (isBusEventType(stored.type) !== true) {
    return [];
  }
  return [
    {
      type,
      projectId: stored.projectId,
      scriptId: "",
      path: stored.path,
      detail: stored.detail,
    },
  ];
}

export function eventTypeForTrigger(trigger: string): string {
  if (trigger === "scheduled") {
    return EVENT_CLOCK_TICK;
  }
  if (trigger === "save") {
    return EVENT_FILE_CHANGED;
  }
  if (trigger === "startup") {
    return EVENT_APP_STARTED;
  }
  if (trigger === "event") {
    return "";
  }
  return "";
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
    if (script.triggerBusEvent.length === 0) {
      return false;
    }
    return canonicalBusEventType(script.triggerBusEvent) === eventType;
  }
  const listenType = eventTypeForTrigger(script.triggerType);
  if (listenType.length === 0) {
    return false;
  }
  if (listenType !== eventType) {
    return false;
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
  if (eventType === EVENT_CLOCK_TICK) {
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
  if (event.detail.length === 0) {
    return eventType;
  }
  return `${eventType}:${event.detail}`;
}
