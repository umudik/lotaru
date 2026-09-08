import {
  EVENT_AGENT_RAN,
  EVENT_INGEST_ALARM,
  EVENT_APP_STARTED,
  CLOCK_INTERVAL_TYPES,
  EVENT_CLOCK_TICK,
  EVENT_FILE_CHANGED,
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
  EVENT_CLOCK_EVERY_1M,
  type EventListenerScript,
  type LotaruEvent,
} from "./events.js";
import { calendarHitsNow, parseCalendarCron } from "./calendar-schedule.js";
import {
  connectorEventTypes,
  connectorOwnsEvent,
  type ConnectorKind,
} from "./connector-catalog.js";

/** Fixed events the platform itself publishes. Rules mint more at runtime. */
export const PLATFORM_EVENT_TYPES = [
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
  for (const known of connectorEventTypes()) {
    if (known === eventType) {
      return true;
    }
  }
  return false;
}

export function subscriberMaySelect(
  eventType: string,
  connectedIds: readonly ConnectorKind[],
): boolean {
  const canonical = canonicalBusEventType(eventType);
  if (isMintedEventType(canonical)) {
    return true;
  }
  for (const known of PLATFORM_EVENT_TYPES) {
    if (known === canonical) {
      return true;
    }
  }
  return connectorOwnsEvent(canonical, connectedIds);
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
  scheduleCron: string;
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
  const cron = template.scheduleCron.trim();
  if (cron.length > 0) {
    if (canonicalBusEventType(event.type) !== EVENT_CLOCK_EVERY_1M) {
      return false;
    }
    try {
      const spec = parseCalendarCron(cron);
      return calendarHitsNow(spec, new Date(event.createdAt));
    } catch {
      return false;
    }
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
