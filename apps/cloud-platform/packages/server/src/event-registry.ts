import {
  EVENT_AGENT_RAN,
  EVENT_APP_STARTED,
  EVENT_CLOCK_TICK,
  EVENT_FILE_CHANGED,
  EVENT_GITHUB_PR_MERGED,
  EVENT_GITHUB_PR_OPENED,
  EVENT_GITHUB_PR_UPDATED,
  EVENT_NOTE_BOOK_CREATED,
  EVENT_NOTE_PAGE_CREATED,
  EVENT_NOTE_PAGE_WRITTEN,
  EVENT_SCRIPT_RAN,
  EVENT_TASK_CREATED,
  EVENT_VOICE_BATCH,
  EVENT_VOICE_SEGMENT,
  canonicalBusEventType,
  isMintedEventType,
  scriptListensToEvent,
  type EventListenerScript,
  type LotaruEvent,
} from "./events.js";

/** Fixed events the platform itself publishes. Rules mint more at runtime. */
export const PLATFORM_EVENT_TYPES = [
  EVENT_GITHUB_PR_OPENED,
  EVENT_GITHUB_PR_UPDATED,
  EVENT_GITHUB_PR_MERGED,
  EVENT_FILE_CHANGED,
  EVENT_CLOCK_TICK,
  EVENT_APP_STARTED,
  EVENT_VOICE_SEGMENT,
  EVENT_VOICE_BATCH,
  EVENT_NOTE_BOOK_CREATED,
  EVENT_NOTE_PAGE_CREATED,
  EVENT_NOTE_PAGE_WRITTEN,
  EVENT_TASK_CREATED,
  EVENT_SCRIPT_RAN,
  EVENT_AGENT_RAN,
];

/**
 * Voice rules and bus-writing agents mint their own event types at runtime, so
 * the fixed catalogue is only half the answer for anything that validates a
 * subscription.
 */
export function isKnownEventType(eventType: string): boolean {
  if (isMintedEventType(eventType)) {
    return true;
  }
  for (const known of PLATFORM_EVENT_TYPES) {
    if (known === eventType) {
      return true;
    }
  }
  return false;
}

/**
 * note.page.written is an accepted alias of note.page.created, so it must stay
 * valid on saved rows while never appearing twice in a picker.
 */
export function selectableEventTypes(): string[] {
  const types: string[] = [];
  for (const eventType of PLATFORM_EVENT_TYPES) {
    if (canonicalBusEventType(eventType) !== eventType) {
      continue;
    }
    types.push(eventType);
  }
  return types;
}

export type EventListenerRef = {
  kind: "script" | "agent" | "knowledge";
  id: string;
  label: string;
};

export type NamedEventScript = EventListenerScript & {
  name: string;
};

export type NamedEventAgent = {
  id: string;
  title: string;
  trigger: "event" | "schedule";
  eventType: string;
  enabled: boolean;
};

export type NamedEventTemplate = {
  id: string;
  title: string;
  eventType: string;
  enabled: boolean;
};

export function agentListensToEvent(agent: NamedEventAgent, event: LotaruEvent): boolean {
  if (agent.enabled !== true) {
    return false;
  }
  if (agent.trigger === "schedule") {
    return event.type === EVENT_CLOCK_TICK;
  }
  if (agent.trigger !== "event") {
    return false;
  }
  return canonicalBusEventType(agent.eventType) === canonicalBusEventType(event.type);
}

export function templateListensToEvent(
  template: NamedEventTemplate,
  event: LotaruEvent,
): boolean {
  if (template.enabled !== true) {
    return false;
  }
  return canonicalBusEventType(template.eventType) === canonicalBusEventType(event.type);
}

export function eventListenerRefs(
  event: LotaruEvent,
  scripts: readonly NamedEventScript[],
  agents: readonly NamedEventAgent[] = [],
  templates: readonly NamedEventTemplate[] = [],
): EventListenerRef[] {
  const refs: EventListenerRef[] = [];
  for (const agent of agents) {
    if (agentListensToEvent(agent, event) !== true) {
      continue;
    }
    refs.push({ kind: "agent", id: agent.id, label: agent.title });
  }
  for (const template of templates) {
    if (templateListensToEvent(template, event) !== true) {
      continue;
    }
    refs.push({ kind: "knowledge", id: template.id, label: template.title });
  }
  for (const script of scripts) {
    if (scriptListensToEvent(script, event) !== true) {
      continue;
    }
    refs.push({ kind: "script", id: script.id, label: script.name });
  }
  return refs;
}
