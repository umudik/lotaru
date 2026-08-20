import { relative } from "node:path";
import micromatch from "micromatch";

export const EVENT_CLOCK_TICK = "clock.tick";
export const EVENT_FILE_CHANGED = "file.changed";
export const EVENT_APP_STARTED = "app.started";
export const EVENT_GITHUB_PR_OPENED = "github.pull_request.opened";
export const EVENT_GITHUB_PR_UPDATED = "github.pull_request.updated";
export const EVENT_GITHUB_PR_MERGED = "github.pull_request.merged";
export const EVENT_VOICE_INTENT = "voice.intent";

export const CLOCK_TICK_MS = 10000;

export const BUS_EVENT_TYPES = [
  EVENT_CLOCK_TICK,
  EVENT_FILE_CHANGED,
  EVENT_APP_STARTED,
  EVENT_GITHUB_PR_OPENED,
  EVENT_GITHUB_PR_UPDATED,
  EVENT_GITHUB_PR_MERGED,
  EVENT_VOICE_INTENT,
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
  enabled: boolean;
};

export function canonicalBusEventType(type: string): string {
  if (type === "schedule.fired") {
    return EVENT_CLOCK_TICK;
  }
  if (type === "manual") {
    return "";
  }
  return type;
}

export function isBusEventType(type: string): boolean {
  const canonical = canonicalBusEventType(type);
  for (const known of BUS_EVENT_TYPES) {
    if (known === canonical) {
      return true;
    }
  }
  return false;
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
  const listenType = eventTypeForTrigger(script.triggerType);
  if (listenType.length === 0) {
    return false;
  }
  const eventType = canonicalBusEventType(event.type);
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
  if (event.detail.length === 0) {
    return eventType;
  }
  return `${eventType}:${event.detail}`;
}
