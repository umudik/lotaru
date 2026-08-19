import {
  EVENT_APP_STARTED,
  EVENT_CLOCK_TICK,
  EVENT_FILE_CHANGED,
  EVENT_GITHUB_PR_MERGED,
  EVENT_GITHUB_PR_OPENED,
  EVENT_GITHUB_PR_UPDATED,
  canonicalBusEventType,
  type LotaruEvent,
} from "./events.js";

export const REACTION_CREATE_TASK = "create_task";
export const REACTION_PROPOSE_KNOWLEDGE = "propose_knowledge";

export type KnowledgeOutputKind = "document" | "diagram";

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

export type KnowledgeReaction = ReactionBase & {
  action: "propose_knowledge";
  knowledgeItemId: string;
  knowledgeOutputs: readonly KnowledgeOutputKind[];
};

export type LotaruReaction = TaskReaction | KnowledgeReaction;

export function parseKnowledgeOutputs(value: string): KnowledgeOutputKind[] {
  let kinds: readonly KnowledgeOutputKind[] = [];
  const chunks = value.split(",");
  for (const chunk of chunks) {
    const part = chunk.trim();
    if (part !== "document" && part !== "diagram") {
      continue;
    }
    let seen = false;
    for (const existing of kinds) {
      if (existing === part) {
        seen = true;
      }
    }
    if (seen !== true) {
      kinds = kinds.concat([part]);
    }
  }
  return kinds.slice();
}

export function knowledgeOutputsText(outputs: readonly KnowledgeOutputKind[]): string {
  let text = "";
  for (const kind of outputs) {
    if (text.length === 0) {
      text = kind;
      continue;
    }
    text = `${text},${kind}`;
  }
  return text;
}

export const REACTION_EVENT_TYPES = [
  EVENT_GITHUB_PR_OPENED,
  EVENT_GITHUB_PR_UPDATED,
  EVENT_GITHUB_PR_MERGED,
  EVENT_FILE_CHANGED,
  EVENT_CLOCK_TICK,
  EVENT_APP_STARTED,
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
  if (reaction.action === REACTION_CREATE_TASK) {
    return true;
  }
  if (reaction.knowledgeItemId.length === 0) {
    return false;
  }
  return reaction.knowledgeOutputs.length > 0;
}

export function reactionFireFingerprint(reaction: LotaruReaction, event: LotaruEvent): string {
  if (reaction.action === REACTION_PROPOSE_KNOWLEDGE) {
    return `${reaction.id}:${event.id}`;
  }
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
