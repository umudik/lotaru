import { z } from "zod";
import { connectorEmits, connectorKindSchema } from "./connector-catalog.js";
import {
  EVENT_GITHUB_PR_MERGED,
  EVENT_GITHUB_PR_OPENED,
  EVENT_GITHUB_PR_UPDATED,
} from "./events.js";

export type HookPublish = {
  type: string;
  projectId: string;
  path: string;
  detail: string;
};

const genericHookSchema = z
  .object({
    type: z.string().min(1),
    projectId: z.string().min(1),
    path: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

const githubRepoSchema = z.object({
  full_name: z.string().min(1),
});

const githubPullSchema = z.object({
  action: z.string(),
  number: z.number().int().positive(),
  pull_request: z.object({
    merged: z.boolean(),
  }),
  repository: githubRepoSchema,
});

const githubIssueHookSchema = z.object({
  action: z.string(),
  issue: z.object({ number: z.number().int().positive() }),
  repository: githubRepoSchema,
});

const githubPushHookSchema = z.object({
  ref: z.string(),
  after: z.string(),
  repository: githubRepoSchema,
});

const slackChallengeSchema = z.object({
  type: z.literal("url_verification"),
  challenge: z.string().min(1),
});

const slackCallbackSchema = z.object({
  type: z.literal("event_callback"),
  event: z.object({
    type: z.string().min(1),
    channel: z.string().optional(),
    user: z.string().optional(),
    text: z.string().optional(),
    ts: z.string().optional(),
    subtype: z.string().optional(),
    reaction: z.string().optional(),
    bot_id: z.string().optional(),
  }),
});

const jiraHookSchema = z.object({
  webhookEvent: z.string().min(1),
  issue: z
    .object({
      key: z.string().min(1),
      fields: z
        .object({
          summary: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

const linearHookSchema = z.object({
  action: z.string().min(1),
  type: z.string().min(1),
  data: z.object({
    id: z.string().min(1),
    identifier: z.string().optional(),
    title: z.string().optional(),
    name: z.string().optional(),
    body: z.string().optional(),
  }),
});

const stripeHookSchema = z.object({
  id: z.string().min(1),
  object: z.literal("event"),
  type: z.string().min(1),
  data: z
    .object({
      object: z
        .object({
          id: z.string().min(1).optional(),
        })
        .optional(),
    })
    .optional(),
});

const notionVerifySchema = z.object({
  verification_token: z.string().min(1),
});

const notionHookSchema = z.object({
  type: z.string().min(1),
  entity: z.object({
    id: z.string().min(1),
    type: z.string().optional(),
  }),
});

export const NOTION_VERIFICATION_SCOPE = "verification";

export function slackUrlChallenge(body: unknown): string {
  const parsed = slackChallengeSchema.safeParse(body);
  if (parsed.success !== true) {
    return "";
  }
  if (parsed.data.challenge.length === 0) {
    return "";
  }
  return parsed.data.challenge;
}

export function mapSlackInnerEvent(inner: string): string {
  if (inner === "message") {
    return "slack.message";
  }
  if (inner === "app_mention") {
    return "slack.app.mention";
  }
  if (inner === "app_home_opened") {
    return "slack.app.home.opened";
  }
  if (inner === "file_public") {
    return "slack.file.public";
  }
  if (inner === "file_shared") {
    return "slack.file.share";
  }
  if (inner === "channel_created") {
    return "slack.channel.created";
  }
  if (inner === "team_join") {
    return "slack.team.join";
  }
  if (inner === "reaction_added") {
    return "slack.reaction.added";
  }
  return "";
}

export function mapJiraWebhookEvent(webhookEvent: string): string {
  const dotted = webhookEvent.replaceAll(":", ".").replaceAll("_", ".");
  if (connectorEmits("jira", dotted)) {
    return dotted;
  }
  const prefixed = `jira.${dotted}`;
  if (connectorEmits("jira", prefixed)) {
    return prefixed;
  }
  return "";
}

export function mapLinearEntityType(entity: string): string {
  if (entity === "Issue") {
    return "linear.issue";
  }
  if (entity === "Comment") {
    return "linear.issue.comment";
  }
  if (entity === "IssueLabel") {
    return "linear.issue.label";
  }
  if (entity === "Project") {
    return "linear.project";
  }
  if (entity === "Cycle") {
    return "linear.cycle";
  }
  if (entity === "Reaction") {
    return "linear.comment.reaction";
  }
  return "";
}

export function mapStripeWebhookType(stripeType: string): string {
  const direct = `stripe.${stripeType}`;
  if (connectorEmits("stripe", direct)) {
    return direct;
  }
  const dotted = `stripe.${stripeType.replaceAll("_", ".")}`;
  if (connectorEmits("stripe", dotted)) {
    return dotted;
  }
  return "";
}

export function mapNotionWebhookType(vendorType: string): string {
  if (vendorType === "page.created") {
    return "notion.page.added";
  }
  if (vendorType === "page.content_updated") {
    return "notion.page.updated";
  }
  if (vendorType === "page.properties_updated") {
    return "notion.page.updated";
  }
  if (vendorType === "page.moved") {
    return "notion.page.updated";
  }
  if (vendorType === "page.undeleted") {
    return "notion.page.updated";
  }
  return "";
}

export function notionVerificationToken(body: unknown): string {
  const parsed = notionVerifySchema.safeParse(body);
  if (parsed.success !== true) {
    return "";
  }
  if (parsed.data.verification_token.length === 0) {
    return "";
  }
  return parsed.data.verification_token;
}

function publishForProjects(
  projectIds: readonly string[],
  type: string,
  path: string,
  detail: string,
): HookPublish[] {
  const listed: HookPublish[] = [];
  for (const projectId of projectIds) {
    if (projectId.length === 0) {
      continue;
    }
    listed.push({ type, projectId, path, detail });
  }
  return listed;
}

function linearPathDetail(data: {
  id: string;
  identifier?: string;
  title?: string;
  name?: string;
  body?: string;
}): { path: string; detail: string } {
  let path = data.id;
  if (data.identifier !== undefined && data.identifier.length > 0) {
    path = data.identifier;
  }
  let detail = path;
  if (data.title !== undefined && data.title.length > 0) {
    detail = data.title;
  } else if (data.name !== undefined && data.name.length > 0) {
    detail = data.name;
  } else if (data.body !== undefined && data.body.length > 0) {
    detail = data.body;
  }
  return { path, detail };
}

function slackPathDetail(event: {
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  reaction?: string;
}): { path: string; detail: string } {
  let path = "";
  if (event.channel !== undefined && event.channel.length > 0) {
    path = event.channel;
  } else if (event.user !== undefined && event.user.length > 0) {
    path = event.user;
  }
  let detail = "";
  if (event.text !== undefined && event.text.length > 0) {
    detail = event.text;
  } else if (event.reaction !== undefined && event.reaction.length > 0) {
    detail = event.reaction;
  } else if (event.ts !== undefined && event.ts.length > 0) {
    detail = event.ts;
  }
  return { path, detail };
}

export function githubWebhookEventName(headers: Record<string, unknown>): string {
  const lower = headerLine(headers, "x-github-event");
  if (lower.length > 0) {
    return lower;
  }
  const mixed = headerLine(headers, "X-GitHub-Event");
  if (mixed.length > 0) {
    return mixed;
  }
  return "";
}

export function hookIngestReply(
  connectorId: string,
  headers: Record<string, unknown>,
  publishedCount: number,
  body: unknown,
): { status: number; accepted: number } {
  if (publishedCount > 0) {
    return { status: 200, accepted: publishedCount };
  }
  if (connectorId === "github") {
    const eventName = githubWebhookEventName(headers);
    if (eventName.length > 0) {
      return { status: 200, accepted: 0 };
    }
  }
  if (connectorId === "slack") {
    if (slackUrlChallenge(body).length > 0) {
      return { status: 200, accepted: 0 };
    }
    const callback = slackCallbackSchema.safeParse(body);
    if (callback.success === true) {
      return { status: 200, accepted: 0 };
    }
  }
  if (connectorId === "jira") {
    const parsed = jiraHookSchema.safeParse(body);
    if (parsed.success === true) {
      return { status: 200, accepted: 0 };
    }
  }
  if (connectorId === "linear") {
    const parsed = linearHookSchema.safeParse(body);
    if (parsed.success === true) {
      return { status: 200, accepted: 0 };
    }
  }
  if (connectorId === "stripe") {
    const parsed = stripeHookSchema.safeParse(body);
    if (parsed.success === true) {
      return { status: 200, accepted: 0 };
    }
  }
  if (connectorId === "notion") {
    if (notionVerificationToken(body).length > 0) {
      return { status: 200, accepted: 0 };
    }
    const parsed = notionHookSchema.safeParse(body);
    if (parsed.success === true) {
      return { status: 200, accepted: 0 };
    }
  }
  return { status: 400, accepted: 0 };
}

function headerLine(headers: Record<string, unknown>, name: string): string {
  const raw = headers[name];
  const asString = z.string().safeParse(raw);
  if (asString.success === true) {
    return asString.data;
  }
  const asList = z.array(z.string()).safeParse(raw);
  if (asList.success !== true) {
    return "";
  }
  const first = asList.data[0];
  if (first === undefined) {
    return "";
  }
  return first;
}

export function mapGithubWebhookEvent(eventName: string, action: string, merged: boolean): string {
  if (eventName === "pull_request") {
    if (action === "opened") {
      return EVENT_GITHUB_PR_OPENED;
    }
    if (action === "synchronize" || action === "edited" || action === "ready_for_review") {
      return EVENT_GITHUB_PR_UPDATED;
    }
    if (action === "closed" && merged === true) {
      return EVENT_GITHUB_PR_MERGED;
    }
    return "github.pull_request";
  }
  const mapped = `github.${eventName}`;
  if (connectorEmits("github", mapped)) {
    return mapped;
  }
  return "";
}

export function parseHookPublish(
  connectorId: string,
  headers: Record<string, unknown>,
  body: unknown,
  projectIdForRepo: (repo: string) => string,
  projectIds: readonly string[],
): HookPublish[] {
  const kind = connectorKindSchema.safeParse(connectorId);
  if (kind.success !== true) {
    return [];
  }
  const githubEvent = headerLine(headers, "x-github-event");
  if (kind.data === "github" && githubEvent.length > 0) {
    if (githubEvent === "pull_request") {
      const parsed = githubPullSchema.safeParse(body);
      if (parsed.success !== true) {
        return [];
      }
      const projectId = projectIdForRepo(parsed.data.repository.full_name);
      if (projectId.length === 0) {
        return [];
      }
      const type = mapGithubWebhookEvent(
        githubEvent,
        parsed.data.action,
        parsed.data.pull_request.merged,
      );
      if (type.length === 0 || connectorEmits("github", type) !== true) {
        return [];
      }
      return [
        {
          type,
          projectId,
          path: parsed.data.repository.full_name,
          detail: String(parsed.data.number),
        },
      ];
    }
    if (githubEvent === "issues") {
      const parsed = githubIssueHookSchema.safeParse(body);
      if (parsed.success !== true) {
        return [];
      }
      const projectId = projectIdForRepo(parsed.data.repository.full_name);
      if (projectId.length === 0) {
        return [];
      }
      return [
        {
          type: "github.issues",
          projectId,
          path: parsed.data.repository.full_name,
          detail: String(parsed.data.issue.number),
        },
      ];
    }
    if (githubEvent === "push") {
      const parsed = githubPushHookSchema.safeParse(body);
      if (parsed.success !== true) {
        return [];
      }
      const projectId = projectIdForRepo(parsed.data.repository.full_name);
      if (projectId.length === 0) {
        return [];
      }
      return [
        {
          type: "github.push",
          projectId,
          path: parsed.data.repository.full_name,
          detail: parsed.data.after,
        },
      ];
    }
    const mapped = mapGithubWebhookEvent(githubEvent, "", false);
    const fallback = genericHookSchema.safeParse(body);
    if (mapped.length > 0 && fallback.success === true && connectorEmits("github", mapped)) {
      return [
        {
          type: mapped,
          projectId: fallback.data.projectId,
          path: fallback.data.path,
          detail: fallback.data.detail,
        },
      ];
    }
    return [];
  }
  if (kind.data === "slack") {
    if (slackUrlChallenge(body).length > 0) {
      return [];
    }
    const callback = slackCallbackSchema.safeParse(body);
    if (callback.success === true) {
      const inner = callback.data.event;
      if (inner.bot_id !== undefined && inner.bot_id.length > 0) {
        return [];
      }
      if (inner.subtype !== undefined && inner.subtype.length > 0) {
        return [];
      }
      const type = mapSlackInnerEvent(inner.type);
      if (type.length === 0 || connectorEmits("slack", type) !== true) {
        return [];
      }
      const facts = slackPathDetail(inner);
      if (facts.path.length === 0 || facts.detail.length === 0) {
        return [];
      }
      return publishForProjects(projectIds, type, facts.path, facts.detail);
    }
  }
  if (kind.data === "jira") {
    const parsed = jiraHookSchema.safeParse(body);
    if (parsed.success === true) {
      const type = mapJiraWebhookEvent(parsed.data.webhookEvent);
      if (type.length === 0 || connectorEmits("jira", type) !== true) {
        return [];
      }
      const issue = parsed.data.issue;
      if (issue === undefined) {
        return [];
      }
      let detail = issue.key;
      if (issue.fields !== undefined && issue.fields.summary !== undefined && issue.fields.summary.length > 0) {
        detail = issue.fields.summary;
      }
      return publishForProjects(projectIds, type, issue.key, detail);
    }
  }
  if (kind.data === "linear") {
    const parsed = linearHookSchema.safeParse(body);
    if (parsed.success === true) {
      const type = mapLinearEntityType(parsed.data.type);
      if (type.length === 0 || connectorEmits("linear", type) !== true) {
        return [];
      }
      const facts = linearPathDetail(parsed.data.data);
      if (facts.path.length === 0 || facts.detail.length === 0) {
        return [];
      }
      return publishForProjects(projectIds, type, facts.path, facts.detail);
    }
  }
  if (kind.data === "stripe") {
    const parsed = stripeHookSchema.safeParse(body);
    if (parsed.success === true) {
      const type = mapStripeWebhookType(parsed.data.type);
      if (type.length === 0 || connectorEmits("stripe", type) !== true) {
        return [];
      }
      return publishForProjects(projectIds, type, parsed.data.id, parsed.data.type);
    }
  }
  if (kind.data === "notion") {
    if (notionVerificationToken(body).length > 0) {
      return [];
    }
    const parsed = notionHookSchema.safeParse(body);
    if (parsed.success === true) {
      const type = mapNotionWebhookType(parsed.data.type);
      if (type.length === 0 || connectorEmits("notion", type) !== true) {
        return [];
      }
      const pageId = parsed.data.entity.id;
      if (pageId.length === 0) {
        return [];
      }
      return publishForProjects(projectIds, type, pageId, pageId);
    }
  }
  const generic = genericHookSchema.safeParse(body);
  if (generic.success !== true) {
    return [];
  }
  if (connectorEmits(kind.data, generic.data.type) !== true) {
    return [];
  }
  return [generic.data];
}
