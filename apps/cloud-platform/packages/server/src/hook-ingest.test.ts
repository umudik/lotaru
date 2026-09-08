import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EVENT_GITHUB_PR_MERGED, EVENT_GITHUB_PR_OPENED, EVENT_JIRA_ISSUE_CREATED } from "./events.js";
import {
  hookIngestReply,
  mapGithubWebhookEvent,
  mapJiraWebhookEvent,
  mapLinearEntityType,
  mapNotionWebhookType,
  mapStripeWebhookType,
  notionVerificationToken,
  parseHookPublish,
  slackUrlChallenge,
} from "./hook-ingest.js";

describe("hook ingest", () => {
  it("maps GitHub pull_request actions and requires a watched repo", () => {
    assert.equal(mapGithubWebhookEvent("pull_request", "opened", false), EVENT_GITHUB_PR_OPENED);
    assert.equal(mapGithubWebhookEvent("pull_request", "closed", true), EVENT_GITHUB_PR_MERGED);
    assert.equal(mapGithubWebhookEvent("push", "", false), "github.push");
    const opened = parseHookPublish(
      "github",
      { "x-github-event": "pull_request" },
      {
        action: "opened",
        number: 9,
        pull_request: { merged: false },
        repository: { full_name: "umudik/lotaru" },
      },
      (repo) => {
        if (repo === "umudik/lotaru") {
          return "proj-1";
        }
        return "";
      },
      [],
    );
    assert.equal(opened.length, 1);
    assert.equal(opened[0]?.type, EVENT_GITHUB_PR_OPENED);
    assert.equal(opened[0]?.detail, "9");
    const skipped = parseHookPublish(
      "github",
      { "x-github-event": "pull_request" },
      {
        action: "opened",
        number: 9,
        pull_request: { merged: false },
        repository: { full_name: "other/repo" },
      },
      () => "",
      [],
    );
    assert.equal(skipped.length, 0);
  });

  it("accepts a typed generic envelope only for that connector", () => {
    const ok = parseHookPublish(
      "slack",
      {},
      { type: "slack.message", projectId: "p1", path: "C123", detail: "hello" },
      () => "",
      [],
    );
    assert.equal(ok.length, 1);
    const wrong = parseHookPublish(
      "slack",
      {},
      { type: "github.push", projectId: "p1", path: "C123", detail: "hello" },
      () => "",
      [],
    );
    assert.equal(wrong.length, 0);
  });

  it("acks GitHub ping and unmapped GitHub events without failing the hook", () => {
    const ping = hookIngestReply("github", { "x-github-event": "ping" }, 0, {});
    assert.equal(ping.status, 200);
    assert.equal(ping.accepted, 0);
    const unmapped = hookIngestReply("github", { "x-github-event": "star" }, 0, {});
    assert.equal(unmapped.status, 200);
    const junk = hookIngestReply("github", {}, 0, {});
    assert.equal(junk.status, 400);
    const slack = hookIngestReply("slack", {}, 0, {});
    assert.equal(slack.status, 400);
    const opened = hookIngestReply("github", { "x-github-event": "pull_request" }, 1, {});
    assert.equal(opened.status, 200);
    assert.equal(opened.accepted, 1);
  });

  it("maps Slack Events API payloads and returns the url verification challenge", () => {
    const challenge = slackUrlChallenge({
      type: "url_verification",
      token: "deprecated",
      challenge: "challenge-token",
    });
    assert.equal(challenge, "challenge-token");
    const handshake = hookIngestReply(
      "slack",
      {},
      0,
      { type: "url_verification", challenge: "challenge-token" },
    );
    assert.equal(handshake.status, 200);
    const posted = parseHookPublish(
      "slack",
      {},
      {
        type: "event_callback",
        event: { type: "message", channel: "C123", text: "hello", ts: "1.2" },
      },
      () => "",
      ["proj-1", "proj-2"],
    );
    assert.equal(posted.length, 2);
    assert.equal(posted[0]?.type, "slack.message");
    assert.equal(posted[0]?.path, "C123");
    const bot = parseHookPublish(
      "slack",
      {},
      {
        type: "event_callback",
        event: { type: "message", channel: "C123", text: "bot", bot_id: "B1" },
      },
      () => "",
      ["proj-1"],
    );
    assert.equal(bot.length, 0);
  });

  it("maps Jira issue webhooks onto catalog types", () => {
    assert.equal(mapJiraWebhookEvent("jira:issue_created"), EVENT_JIRA_ISSUE_CREATED);
    assert.equal(mapJiraWebhookEvent("comment_created"), "jira.comment.created");
    const created = parseHookPublish(
      "jira",
      {},
      {
        webhookEvent: "jira:issue_created",
        issue: { key: "LOT-9", fields: { summary: "Catch-up" } },
      },
      () => "",
      ["proj-1"],
    );
    assert.equal(created.length, 1);
    assert.equal(created[0]?.type, EVENT_JIRA_ISSUE_CREATED);
    assert.equal(created[0]?.path, "LOT-9");
    const ack = hookIngestReply(
      "jira",
      {},
      0,
      { webhookEvent: "jira:issue_updated", issue: { key: "LOT-9" } },
    );
    assert.equal(ack.status, 200);
  });

  it("maps Linear, Stripe, and Notion vendor payloads onto catalog types", () => {
    assert.equal(mapLinearEntityType("Issue"), "linear.issue");
    assert.equal(mapLinearEntityType("Comment"), "linear.issue.comment");
    assert.equal(mapStripeWebhookType("charge.succeeded"), "stripe.charge.succeeded");
    assert.equal(
      mapStripeWebhookType("account.external_account.created"),
      "stripe.account.external.account.created",
    );
    assert.equal(
      mapStripeWebhookType("customer.subscription.trial_will_end"),
      "stripe.customer.subscription.trial.will.end",
    );
    assert.equal(mapNotionWebhookType("page.created"), "notion.page.added");
    assert.equal(mapNotionWebhookType("page.content_updated"), "notion.page.updated");
    const issue = parseHookPublish(
      "linear",
      {},
      {
        action: "create",
        type: "Issue",
        data: { id: "issue-1", identifier: "ENG-9", title: "Catch-up" },
      },
      () => "",
      ["proj-1"],
    );
    assert.equal(issue.length, 1);
    assert.equal(issue[0]?.type, "linear.issue");
    assert.equal(issue[0]?.path, "ENG-9");
    const documentAck = hookIngestReply(
      "linear",
      {},
      0,
      { action: "create", type: "Document", data: { id: "doc-1" } },
    );
    assert.equal(documentAck.status, 200);
    const charged = parseHookPublish(
      "stripe",
      {},
      {
        id: "evt_1",
        object: "event",
        type: "charge.succeeded",
        data: { object: { id: "ch_1" } },
      },
      () => "",
      ["proj-1"],
    );
    assert.equal(charged.length, 1);
    assert.equal(charged[0]?.type, "stripe.charge.succeeded");
    assert.equal(charged[0]?.path, "evt_1");
    const page = parseHookPublish(
      "notion",
      {},
      {
        type: "page.created",
        entity: { id: "page-1", type: "page" },
      },
      () => "",
      ["proj-1"],
    );
    assert.equal(page.length, 1);
    assert.equal(page[0]?.type, "notion.page.added");
    const handshake = notionVerificationToken({ verification_token: "secret_verify" });
    assert.equal(handshake, "secret_verify");
    const verifyAck = hookIngestReply("notion", {}, 0, { verification_token: "secret_verify" });
    assert.equal(verifyAck.status, 200);
    const junk = hookIngestReply("linear", {}, 0, {});
    assert.equal(junk.status, 400);
  });
});
