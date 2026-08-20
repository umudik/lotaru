import {
  EVENT_APP_STARTED,
  EVENT_CLOCK_TICK,
  EVENT_FILE_CHANGED,
  EVENT_GITHUB_PR_MERGED,
  EVENT_GITHUB_PR_OPENED,
  EVENT_GITHUB_PR_UPDATED,
  EVENT_VOICE_INTENT,
  canonicalBusEventType,
  scriptListensToEvent,
  type EventListenerScript,
  type LotaruEvent,
} from "./events.js";

export const REACTION_CREATE_TASK = "create_task";

type ReactionBase = {
  id: string;
  projectId: string;
  eventType: string;
  repo: string;
  enabled: boolean;
  createdAt: number;
};

export type TaskReaction = ReactionBase & {
  action: "create_task";
  titleTemplate: string;
};

export type LotaruReaction = TaskReaction;

export const REACTION_EVENT_TYPES = [
  EVENT_GITHUB_PR_OPENED,
  EVENT_GITHUB_PR_UPDATED,
  EVENT_GITHUB_PR_MERGED,
  EVENT_FILE_CHANGED,
  EVENT_CLOCK_TICK,
  EVENT_APP_STARTED,
  EVENT_VOICE_INTENT,
];

export function reactionEventTypesForClient(githubReady: boolean): string[] {
  const types: string[] = [];
  for (const eventType of REACTION_EVENT_TYPES) {
    if (eventType.startsWith("github.") && githubReady !== true) {
      continue;
    }
    types.push(eventType);
  }
  if (types.length > 0) {
    return types;
  }
  return [EVENT_FILE_CHANGED];
}

function eventFieldsMatch(reaction: LotaruReaction, event: LotaruEvent): boolean {
  if (reaction.enabled !== true) {
    return false;
  }
  if (reaction.projectId !== event.projectId) {
    return false;
  }
  if (canonicalBusEventType(reaction.eventType) !== canonicalBusEventType(event.type)) {
    return false;
  }
  if (reaction.repo.length > 0 && reaction.repo !== event.path) {
    return false;
  }
  return true;
}

export function reactionMatchesEvent(reaction: LotaruReaction, event: LotaruEvent): boolean {
  if (eventFieldsMatch(reaction, event) !== true) {
    return false;
  }
  return reaction.action === REACTION_CREATE_TASK;
}

export function reactionFireFingerprint(reaction: LotaruReaction, event: LotaruEvent): string {
  return reactionFingerprint(reaction.id, event);
}

export function fillReactionTitle(template: string, event: LotaruEvent): string {
  let title = template.trim();
  if (title.length === 0) {
    title = "{{type}} {{path}} #{{detail}}";
  }
  title = title.split("{{type}}").join(event.type);
  title = title.split("{{path}}").join(event.path);
  title = title.split("{{detail}}").join(event.detail);
  const compact = title.replaceAll("  ", " ").trim();
  if (compact.length === 0) {
    return event.type;
  }
  if (compact.length <= 200) {
    return compact;
  }
  return compact.slice(0, 200);
}

export function reactionFingerprint(reactionId: string, event: LotaruEvent): string {
  return `${reactionId}:${event.type}:${event.path}:${event.detail}`;
}

export type EventListenerRef = {
  kind: "reaction" | "script";
  id: string;
  label: string;
};

export type NamedEventScript = EventListenerScript & {
  name: string;
};

export function reactionListenerLabel(reaction: LotaruReaction): string {
  const title = reaction.titleTemplate.trim();
  if (title.length > 0) {
    return title;
  }
  return "Create a task";
}

export function eventListenerRefs(
  event: LotaruEvent,
  reactions: readonly LotaruReaction[],
  scripts: readonly NamedEventScript[],
): EventListenerRef[] {
  const refs: EventListenerRef[] = [];
  for (const reaction of reactions) {
    if (reactionMatchesEvent(reaction, event) !== true) {
      continue;
    }
    refs.push({
      kind: "reaction",
      id: reaction.id,
      label: reactionListenerLabel(reaction),
    });
  }
  for (const script of scripts) {
    if (scriptListensToEvent(script, event) !== true) {
      continue;
    }
    refs.push({
      kind: "script",
      id: script.id,
      label: script.name,
    });
  }
  return refs;
}
