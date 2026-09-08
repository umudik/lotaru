import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  connectionEventsFor,
  connectorById,
  connectorEmits,
  listConnectors,
  requireConnectorEvent,
} from "./connector-catalog.js";
import {
  EVENT_CLOCK_TICK,
  EVENT_GITHUB_PR_OPENED,
  EVENT_GMAIL_MESSAGE_RECEIVED,
  EVENT_JIRA_ISSUE_CREATED,
  EVENT_NOTION_PAGE_ADDED,
  EVENT_OUTLOOK_MESSAGE_RECEIVED,
  isBusEventType,
} from "./events.js";
import { subscriberMaySelect } from "./event-registry.js";

describe("connector catalog", () => {
  it("lists product trigger connections from the integration catalog", () => {
    const connectors = listConnectors();
    assert.equal(connectors.length >= 80, true);
    const github = connectorById("github")[0];
    const google = connectorById("google")[0];
    const clickup = connectorById("clickup")[0];
    const slack = connectorById("slack")[0];
    if (github === undefined || google === undefined || clickup === undefined || slack === undefined) {
      assert.fail("expected github, google, clickup, and slack connectors");
      return;
    }
    assert.equal(github.events.length, 45);
    let hasPush = false;
    let hasWildcard = false;
    for (const listed of github.events) {
      assert.equal(isBusEventType(listed.type), true);
      if (listed.type === "github.push") {
        hasPush = true;
      }
      if (listed.type === "github.*") {
        hasWildcard = true;
      }
    }
    assert.equal(hasPush, true);
    assert.equal(hasWildcard, false);
    assert.equal(connectorEmits("github", EVENT_GITHUB_PR_OPENED), true);
    assert.equal(connectorEmits("google", EVENT_GMAIL_MESSAGE_RECEIVED), true);
    assert.equal(connectorEmits("outlook", EVENT_OUTLOOK_MESSAGE_RECEIVED), true);
    assert.equal(connectorEmits("notion", EVENT_NOTION_PAGE_ADDED), true);
    assert.equal(connectorEmits("jira", EVENT_JIRA_ISSUE_CREATED), true);
    assert.equal(connectorEmits("clickup", "clickup.task.created"), true);
    assert.equal(connectorEmits("slack", "slack.message"), true);
    assert.equal(connectorById("n8n").length, 0);
  });

  it("exposes connection events only for connected connectors", () => {
    assert.equal(connectionEventsFor([]).length, 0);
    const githubEvents = connectionEventsFor(["github"]);
    assert.equal(githubEvents.length, 45);
    let installation: { type: string; label: string; sourceId: string; sourceLabel: string } | undefined;
    for (const listed of githubEvents) {
      if (listed.type === "github.installation") {
        installation = listed;
      }
    }
    assert.equal(installation?.label, "App installed");
    assert.equal(installation?.sourceId, "github");
    assert.equal(installation?.sourceLabel, "GitHub");
    assert.equal(subscriberMaySelect(EVENT_GITHUB_PR_OPENED, []), false);
    assert.equal(subscriberMaySelect("github.push", ["github"]), true);
    assert.equal(subscriberMaySelect(EVENT_CLOCK_TICK, []), true);
    assert.equal(subscriberMaySelect(EVENT_GMAIL_MESSAGE_RECEIVED, ["google"]), true);
    assert.equal(subscriberMaySelect("clickup.task.created", ["clickup"]), true);
  });

  it("refuses an event the connector does not mint", () => {
    assert.equal(connectorEmits("github", EVENT_CLOCK_TICK), false);
    assert.equal(connectorById("not-a-tool").length, 0);
    assert.throws(() => {
      requireConnectorEvent("github", EVENT_CLOCK_TICK);
    }, /does not emit/);
    requireConnectorEvent("github", "github.push");
    requireConnectorEvent("google", EVENT_GMAIL_MESSAGE_RECEIVED);
    requireConnectorEvent("jira", EVENT_JIRA_ISSUE_CREATED);
    requireConnectorEvent("clickup", "clickup.task.created");
  });
});
