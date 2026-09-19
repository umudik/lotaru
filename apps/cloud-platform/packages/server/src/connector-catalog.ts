import { z } from "zod";

export const CONNECTOR_KIND_VALUES = [
  "github",
  "activecampaign",
  "acuityscheduling",
  "affinity",
  "airtable",
  "amqp",
  "asana",
  "autopilot",
  "aws.sns",
  "azuredevops",
  "bitbucket",
  "box",
  "brevo",
  "cal",
  "calendly",
  "chargebee",
  "clickup",
  "clockify",
  "convertkit",
  "copper",
  "currents",
  "customerio",
  "emelia",
  "eventbrite",
  "facebook",
  "facebookleadads",
  "figma",
  "flow",
  "formio",
  "formstack",
  "getresponse",
  "gitlab",
  "google",
  "gumroad",
  "helpscout",
  "hubspot",
  "invoiceninja",
  "jira",
  "jotform",
  "kafka",
  "keap",
  "kobotoolbox",
  "lemlist",
  "linear",
  "lonescale",
  "mailchimp",
  "mailerlite",
  "mailjet",
  "mautic",
  "mqtt",
  "netlify",
  "notion",
  "onedrive",
  "onfleet",
  "outlook",
  "paypal",
  "pipedrive",
  "postgres",
  "postmark",
  "pushcut",
  "rabbitmq",
  "redis",
  "rss",
  "salesforce",
  "seatable",
  "shopify",
  "slack",
  "strava",
  "stripe",
  "surveymonkey",
  "taiga",
  "teams",
  "telegram",
  "thehive",
  "thehive5",
  "toggl",
  "trello",
  "twilio",
  "typeform",
  "venafi.cloud",
  "venafi.datacenter",
  "webex",
  "webflow",
  "whatsapp",
  "wise",
  "woocommerce",
  "workable",
  "wufoo",
  "zendesk",
] as const;

export const connectorKindSchema = z.enum(CONNECTOR_KIND_VALUES);

export type ConnectorKind = (typeof CONNECTOR_KIND_VALUES)[number];

export type ConnectorIntake = "poll" | "webhook" | "trigger";

export type ConnectorEvent = {
  type: string;
  label: string;
};

export type ListedConnectionEvent = ConnectorEvent & {
  sourceId: ConnectorKind;
  sourceLabel: string;
};

export type Connector = {
  id: ConnectorKind;
  label: string;
  intake: ConnectorIntake;
  events: readonly ConnectorEvent[];
};

const CONNECTORS: readonly Connector[] = [
  {
    id: "github",
    label: "GitHub",
    intake: "poll",
    events: [
      { type: "github.check_run", label: "Check run" },
      { type: "github.check_suite", label: "Check suite" },
      { type: "github.commit_comment", label: "Commit comment" },
      { type: "github.create", label: "Branch or tag created" },
      { type: "github.delete", label: "Branch or tag deleted" },
      { type: "github.deploy_key", label: "Deploy key" },
      { type: "github.deployment", label: "Deployment" },
      { type: "github.deployment_status", label: "Deployment status" },
      { type: "github.fork", label: "Fork" },
      { type: "github.github_app_authorization", label: "GitHub App authorization" },
      { type: "github.gollum", label: "Wiki page updated" },
      { type: "github.installation", label: "App installed" },
      { type: "github.installation_repositories", label: "App repositories changed" },
      { type: "github.issue_comment", label: "Issue comment" },
      { type: "github.issues", label: "Issues" },
      { type: "github.label", label: "Label" },
      { type: "github.marketplace_purchase", label: "Marketplace purchase" },
      { type: "github.member", label: "Member" },
      { type: "github.membership", label: "Membership" },
      { type: "github.meta", label: "Webhook ping" },
      { type: "github.milestone", label: "Milestone" },
      { type: "github.org_block", label: "Org block" },
      { type: "github.organization", label: "Organization" },
      { type: "github.page_build", label: "Page build" },
      { type: "github.project", label: "Project" },
      { type: "github.project_card", label: "Project card" },
      { type: "github.project_column", label: "Project column" },
      { type: "github.public", label: "Repository made public" },
      { type: "github.pull_request", label: "Pull request" },
      { type: "github.pull_request_review", label: "Pull request review" },
      { type: "github.pull_request_review_comment", label: "Pull request review comment" },
      { type: "github.push", label: "Push" },
      { type: "github.release", label: "Release" },
      { type: "github.repository", label: "Repository" },
      { type: "github.repository_import", label: "Repository import" },
      { type: "github.repository_vulnerability_alert", label: "Repository vulnerability alert" },
      { type: "github.security_advisory", label: "Security advisory" },
      { type: "github.star", label: "Star" },
      { type: "github.status", label: "Status" },
      { type: "github.team", label: "Team" },
      { type: "github.team_add", label: "Team add" },
      { type: "github.watch", label: "Repository watched" },
      { type: "github.pull_request.opened", label: "Pull request opened" },
      { type: "github.pull_request.updated", label: "Pull request updated" },
      { type: "github.pull_request.merged", label: "Pull request merged" },
    ],
  },
  {
    id: "activecampaign",
    label: "Active Campaign",
    intake: "trigger",
    events: [
      { type: "activecampaign.public", label: "sources" },
      { type: "activecampaign.admin", label: "Admin" },
      { type: "activecampaign.api", label: "Api" },
      { type: "activecampaign.system", label: "System" },
    ],
  },
  {
    id: "acuityscheduling",
    label: "Acuity Scheduling",
    intake: "trigger",
    events: [
      { type: "acuityscheduling.appointment.canceled", label: "Appointment Canceled" },
      { type: "acuityscheduling.appointment.changed", label: "Appointment Changed" },
      { type: "acuityscheduling.appointment.rescheduled", label: "Appointment Rescheduled" },
      { type: "acuityscheduling.appointment.scheduled", label: "Appointment Scheduled" },
      { type: "acuityscheduling.order.completed", label: "Order Completed" },
    ],
  },
  {
    id: "affinity",
    label: "Affinity",
    intake: "trigger",
    events: [
      { type: "affinity.field.value.created", label: "field_value.created" },
      { type: "affinity.field.value.deleted", label: "field_value.deleted" },
      { type: "affinity.field.value.updated", label: "field_value.updated" },
      { type: "affinity.field.created", label: "Field Created" },
      { type: "affinity.field.deleted", label: "Field Deleted" },
      { type: "affinity.field.updated", label: "Field Updated" },
      { type: "affinity.file.created", label: "File Created" },
      { type: "affinity.file.deleted", label: "File Deleted" },
      { type: "affinity.list.entry.created", label: "list_entry.created" },
      { type: "affinity.list.entry.deleted", label: "list_entry.deleted" },
      { type: "affinity.list.created", label: "List Created" },
      { type: "affinity.list.deleted", label: "List Deleted" },
      { type: "affinity.list.updated", label: "List Updated" },
      { type: "affinity.note.created", label: "Note Created" },
      { type: "affinity.note.deleted", label: "Note Deleted" },
      { type: "affinity.note.updated", label: "Note Updated" },
      { type: "affinity.opportunity.created", label: "Opportunity Created" },
      { type: "affinity.opportunity.deleted", label: "Opportunity Deleted" },
      { type: "affinity.opportunity.updated", label: "Opportunity Updated" },
      { type: "affinity.organization.created", label: "Organization Created" },
      { type: "affinity.organization.deleted", label: "Organization Deleted" },
      { type: "affinity.organization.updated", label: "Organization Updated" },
      { type: "affinity.person.created", label: "Person Created" },
      { type: "affinity.person.deleted", label: "Person Deleted" },
      { type: "affinity.person.updated", label: "Person Updated" },
    ],
  },
  {
    id: "airtable",
    label: "Airtable",
    intake: "trigger",
    events: [
      { type: "airtable.triggered", label: "Triggered" },
    ],
  },
  {
    id: "amqp",
    label: "Amqp",
    intake: "trigger",
    events: [
      { type: "amqp.triggered", label: "Triggered" },
    ],
  },
  {
    id: "asana",
    label: "Asana",
    intake: "trigger",
    events: [
      { type: "asana.triggered", label: "Triggered" },
    ],
  },
  {
    id: "autopilot",
    label: "Autopilot",
    intake: "trigger",
    events: [
      { type: "autopilot.contactadded", label: "Contact Added" },
      { type: "autopilot.contactaddedtolist", label: "Contact Added To List" },
      { type: "autopilot.contactenteredsegment", label: "Contact Entered Segment" },
      { type: "autopilot.contactleftsegment", label: "Contact Left Segment" },
      { type: "autopilot.contactremovedfromlist", label: "Contact Removed From List" },
      { type: "autopilot.contactunsubscribed", label: "Contact Unsubscribed" },
      { type: "autopilot.contactupdated", label: "Contact Updated" },
    ],
  },
  {
    id: "aws.sns",
    label: "AWS SNS",
    intake: "trigger",
    events: [
      { type: "aws.sns.triggered", label: "Triggered" },
    ],
  },
  {
    id: "azuredevops",
    label: "Azure DevOps",
    intake: "trigger",
    events: [
      { type: "azuredevops.triggered", label: "Triggered" },
    ],
  },
  {
    id: "bitbucket",
    label: "Bitbucket",
    intake: "trigger",
    events: [
      { type: "bitbucket.triggered", label: "Triggered" },
    ],
  },
  {
    id: "box",
    label: "Box",
    intake: "trigger",
    events: [
      { type: "box.collaboration.accepted", label: "Collaboration Accepted" },
      { type: "box.collaboration.created", label: "Collaboration Created" },
      { type: "box.collaboration.rejected", label: "Collaboration Rejected" },
      { type: "box.collaboration.removed", label: "Collaboration Removed" },
      { type: "box.collaboration.updated", label: "Collaboration Updated" },
      { type: "box.comment.created", label: "Comment Created" },
      { type: "box.comment.deleted", label: "Comment Deleted" },
      { type: "box.comment.updated", label: "Comment Updated" },
      { type: "box.file.copied", label: "File Copied" },
      { type: "box.file.deleted", label: "File Deleted" },
      { type: "box.file.downloaded", label: "File Downloaded" },
      { type: "box.file.locked", label: "File Locked" },
      { type: "box.file.moved", label: "File Moved" },
      { type: "box.file.previewed", label: "File Previewed" },
      { type: "box.file.renamed", label: "File Renamed" },
      { type: "box.file.restored", label: "File Restored" },
      { type: "box.file.trashed", label: "File Trashed" },
      { type: "box.file.unlocked", label: "File Unlocked" },
      { type: "box.file.uploaded", label: "File Uploaded" },
      { type: "box.folder.copied", label: "Folder Copied" },
      { type: "box.folder.created", label: "Folder Created" },
      { type: "box.folder.deleted", label: "Folder Deleted" },
      { type: "box.folder.downloaded", label: "Folder Downloaded" },
      { type: "box.folder.moved", label: "Folder Moved" },
      { type: "box.folder.renamed", label: "Folder Renamed" },
      { type: "box.folder.restored", label: "Folder Restored" },
      { type: "box.folder.trashed", label: "Folder Trashed" },
      { type: "box.metadata.instance.created", label: "Metadata Instance Created" },
      { type: "box.metadata.instance.deleted", label: "Metadata Instance Deleted" },
      { type: "box.metadata.instance.updated", label: "Metadata Instance Updated" },
      { type: "box.shared.link.created", label: "Sharedlink Created" },
      { type: "box.shared.link.deleted", label: "Sharedlink Deleted" },
      { type: "box.shared.link.updated", label: "Sharedlink Updated" },
      { type: "box.task.assignment.created", label: "Task Assignment Created" },
      { type: "box.task.assignment.updated", label: "Task Assignment Updated" },
      { type: "box.webhook.deleted", label: "Webhook Deleted" },
      { type: "box.file", label: "targetType" },
      { type: "box.folder", label: "Folder" },
    ],
  },
  {
    id: "brevo",
    label: "Brevo",
    intake: "trigger",
    events: [
      { type: "brevo.blocked", label: "Email Blocked" },
      { type: "brevo.click", label: "Email Clicked" },
      { type: "brevo.deferred", label: "Email Deferred" },
      { type: "brevo.delivered", label: "Email Delivered" },
      { type: "brevo.hardbounce", label: "Email Hard Bounce" },
      { type: "brevo.invalid", label: "Email Invalid" },
      { type: "brevo.spam", label: "Email Marked Spam" },
      { type: "brevo.opened", label: "Email Opened" },
      { type: "brevo.request", label: "Email Sent" },
      { type: "brevo.softbounce", label: "Email Soft-Bounce" },
      { type: "brevo.uniqueopened", label: "Email Unique Open" },
      { type: "brevo.unsubscribed", label: "Email Unsubscribed" },
      { type: "brevo.listaddition", label: "Marketing Email List Addition" },
      { type: "brevo.inboundemailprocessed", label: "Inbound Email Processed" },
    ],
  },
  {
    id: "cal",
    label: "Cal",
    intake: "trigger",
    events: [
      { type: "cal.triggered", label: "Triggered" },
    ],
  },
  {
    id: "calendly",
    label: "Calendly",
    intake: "trigger",
    events: [
      { type: "calendly.triggered", label: "Triggered" },
    ],
  },
  {
    id: "chargebee",
    label: "Chargebee",
    intake: "trigger",
    events: [
      { type: "chargebee.card.added", label: "Card Added" },
      { type: "chargebee.card.deleted", label: "Card Deleted" },
      { type: "chargebee.card.expired", label: "Card Expired" },
      { type: "chargebee.card.expiring", label: "Card Expiring" },
      { type: "chargebee.card.updated", label: "Card Updated" },
      { type: "chargebee.customer.changed", label: "Customer Changed" },
      { type: "chargebee.customer.created", label: "Customer Created" },
      { type: "chargebee.customer.deleted", label: "Customer Deleted" },
      { type: "chargebee.invoice.created", label: "Invoice Created" },
      { type: "chargebee.invoice.deleted", label: "Invoice Deleted" },
      { type: "chargebee.invoice.generated", label: "Invoice Generated" },
      { type: "chargebee.invoice.updated", label: "Invoice Updated" },
      { type: "chargebee.payment.failed", label: "Payment Failed" },
      { type: "chargebee.payment.initiated", label: "Payment Initiated" },
      { type: "chargebee.payment.refunded", label: "Payment Refunded" },
      { type: "chargebee.payment.succeeded", label: "Payment Succeeded" },
      { type: "chargebee.refund.initiated", label: "Refund Initiated" },
      { type: "chargebee.subscription.activated", label: "Subscription Activated" },
      { type: "chargebee.subscription.cancellation.scheduled", label: "Subscription Cancellation Scheduled" },
      { type: "chargebee.subscription.cancelled", label: "Subscription Cancelled" },
      { type: "chargebee.subscription.cancelling", label: "Subscription Cancelling" },
      { type: "chargebee.subscription.changed", label: "Subscription Changed" },
      { type: "chargebee.subscription.created", label: "Subscription Created" },
      { type: "chargebee.subscription.deleted", label: "Subscription Deleted" },
      { type: "chargebee.subscription.reactivated", label: "Subscription Reactivated" },
      { type: "chargebee.subscription.renewal.reminder", label: "Subscription Renewal Reminder" },
      { type: "chargebee.subscription.renewed", label: "Subscription Renewed" },
      { type: "chargebee.subscription.scheduled.cancellation.removed", label: "Subscription Scheduled Cancellation Removed" },
      { type: "chargebee.subscription.shipping.address.updated", label: "Subscription Shipping Address Updated" },
      { type: "chargebee.subscription.started", label: "Subscription Started" },
      { type: "chargebee.subscription.trial.ending", label: "Subscription Trial Ending" },
      { type: "chargebee.transaction.created", label: "Transaction Created" },
      { type: "chargebee.transaction.deleted", label: "Transaction Deleted" },
      { type: "chargebee.transaction.updated", label: "Transaction Updated" },
    ],
  },
  {
    id: "clickup",
    label: "Click Up",
    intake: "trigger",
    events: [
      { type: "clickup.folder.created", label: "Folder Created" },
      { type: "clickup.folder.deleted", label: "Folder Deleted" },
      { type: "clickup.folder.updated", label: "Folder Updated" },
      { type: "clickup.goal.created", label: "Goal Created" },
      { type: "clickup.goal.deleted", label: "Goal Deleted" },
      { type: "clickup.goal.updated", label: "Goal Updated" },
      { type: "clickup.keyresult.created", label: "keyResult.created" },
      { type: "clickup.keyresult.deleted", label: "keyResult.deleted" },
      { type: "clickup.keyresult.updated", label: "keyResult.updated" },
      { type: "clickup.list.created", label: "List Created" },
      { type: "clickup.list.deleted", label: "List Deleted" },
      { type: "clickup.list.updated", label: "List Updated" },
      { type: "clickup.space.created", label: "Space Created" },
      { type: "clickup.space.deleted", label: "Space Deleted" },
      { type: "clickup.space.updated", label: "Space Updated" },
      { type: "clickup.task.assignee.updated", label: "Task Assignee Updated" },
      { type: "clickup.task.comment.posted", label: "Task Comment Posted" },
      { type: "clickup.task.comment.updated", label: "Task Comment Updated" },
      { type: "clickup.task.created", label: "Task Created" },
      { type: "clickup.task.deleted", label: "Task Deleted" },
      { type: "clickup.task.duedate.updated", label: "Task DueDate Updated" },
      { type: "clickup.task.moved", label: "Task Moved" },
      { type: "clickup.task.status.updated", label: "Task Status Updated" },
      { type: "clickup.task.tag.updated", label: "Task Tag Updated" },
      { type: "clickup.task.timeestimate.updated", label: "Task TimeEstimate Updated" },
      { type: "clickup.task.timetracked.updated", label: "Task TimeTracked Updated" },
      { type: "clickup.task.updated", label: "Task Updated" },
    ],
  },
  {
    id: "clockify",
    label: "Clockify",
    intake: "trigger",
    events: [
      { type: "clockify.triggered", label: "Triggered" },
    ],
  },
  {
    id: "convertkit",
    label: "Convert Kit",
    intake: "trigger",
    events: [
      { type: "convertkit.formsubscribe", label: "Form Subscribe" },
      { type: "convertkit.linkclick", label: "Link Click" },
      { type: "convertkit.productpurchase", label: "Product Purchase" },
      { type: "convertkit.purchasecreate", label: "Purchase Created" },
      { type: "convertkit.coursecomplete", label: "Sequence Complete" },
      { type: "convertkit.coursesubscribe", label: "Sequence Subscribe" },
      { type: "convertkit.subscriberactivate", label: "Subscriber Activated" },
      { type: "convertkit.subscriberunsubscribe", label: "Subscriber Unsubscribe" },
      { type: "convertkit.tagadd", label: "Tag Add" },
      { type: "convertkit.tagremove", label: "Tag Remove" },
    ],
  },
  {
    id: "copper",
    label: "Copper",
    intake: "trigger",
    events: [
      { type: "copper.delete", label: "Delete" },
      { type: "copper.new", label: "New" },
      { type: "copper.update", label: "Update" },
    ],
  },
  {
    id: "currents",
    label: "Currents",
    intake: "trigger",
    events: [
      { type: "currents.run.canceled", label: "Run Canceled" },
      { type: "currents.run.finish", label: "Run Finished" },
      { type: "currents.run.start", label: "Run Started" },
      { type: "currents.run.timeout", label: "Run Timeout" },
    ],
  },
  {
    id: "customerio",
    label: "Customer Io",
    intake: "trigger",
    events: [
      { type: "customerio.customer.subscribed", label: "Customer Subscribed" },
      { type: "customerio.customer.unsubscribed", label: "Customer Unsubscribe" },
      { type: "customerio.email.attempted", label: "Email Attempted" },
      { type: "customerio.email.bounced", label: "Email Bounced" },
      { type: "customerio.email.clicked", label: "Email Clicked" },
      { type: "customerio.email.converted", label: "Email Converted" },
      { type: "customerio.email.delivered", label: "Email Delivered" },
      { type: "customerio.email.drafted", label: "Email Drafted" },
      { type: "customerio.email.failed", label: "Email Failed" },
      { type: "customerio.email.opened", label: "Email Opened" },
      { type: "customerio.email.sent", label: "Email Sent" },
      { type: "customerio.email.spammed", label: "Email Spammed" },
      { type: "customerio.push.attempted", label: "Push Attempted" },
      { type: "customerio.push.bounced", label: "Push Bounced" },
      { type: "customerio.push.clicked", label: "Push Clicked" },
      { type: "customerio.push.delivered", label: "Push Delivered" },
      { type: "customerio.push.drafted", label: "Push Drafted" },
      { type: "customerio.push.failed", label: "Push Failed" },
      { type: "customerio.push.opened", label: "Push Opened" },
      { type: "customerio.push.sent", label: "Push Sent" },
      { type: "customerio.slack.attempted", label: "Slack Attempted" },
      { type: "customerio.slack.clicked", label: "Slack Clicked" },
      { type: "customerio.slack.drafted", label: "Slack Drafted" },
      { type: "customerio.slack.failed", label: "Slack Failed" },
      { type: "customerio.slack.sent", label: "Slack Sent" },
      { type: "customerio.sms.attempted", label: "SMS Attempted" },
      { type: "customerio.sms.bounced", label: "SMS Bounced" },
      { type: "customerio.sms.clicked", label: "SMS Clicked" },
      { type: "customerio.sms.delivered", label: "SMS Delivered" },
      { type: "customerio.sms.drafted", label: "SMS Drafted" },
      { type: "customerio.sms.failed", label: "SMS Failed" },
      { type: "customerio.sms.sent", label: "SMS Sent" },
    ],
  },
  {
    id: "emelia",
    label: "Emelia",
    intake: "trigger",
    events: [
      { type: "emelia.bounced", label: "Email Bounced" },
      { type: "emelia.opened", label: "Email Opened" },
      { type: "emelia.replied", label: "Email Replied" },
      { type: "emelia.sent", label: "Email Sent" },
      { type: "emelia.clicked", label: "Link Clicked" },
      { type: "emelia.unsubscribed", label: "Unsubscribed Contact" },
    ],
  },
  {
    id: "eventbrite",
    label: "Eventbrite",
    intake: "trigger",
    events: [
      { type: "eventbrite.attendee.checked.in", label: "attendee.checked_in" },
      { type: "eventbrite.attendee.checked.out", label: "attendee.checked_out" },
      { type: "eventbrite.attendee.updated", label: "Attendee Updated" },
      { type: "eventbrite.event.created", label: "Event Created" },
      { type: "eventbrite.event.published", label: "Event Published" },
      { type: "eventbrite.event.unpublished", label: "Event Unpublished" },
      { type: "eventbrite.event.updated", label: "Event Updated" },
      { type: "eventbrite.order.placed", label: "Order Placed" },
      { type: "eventbrite.order.refunded", label: "Order Refunded" },
      { type: "eventbrite.order.updated", label: "Order Updated" },
      { type: "eventbrite.organizer.updated", label: "Organizer Updated" },
      { type: "eventbrite.ticket.class.created", label: "ticket_class.created" },
      { type: "eventbrite.ticket.class.deleted", label: "ticket_class.deleted" },
      { type: "eventbrite.ticket.class.updated", label: "ticket_class.updated" },
      { type: "eventbrite.venue.updated", label: "Venue Updated" },
      { type: "eventbrite.all", label: "All" },
    ],
  },
  {
    id: "facebook",
    label: "Facebook",
    intake: "trigger",
    events: [
      { type: "facebook.triggered", label: "Triggered" },
    ],
  },
  {
    id: "facebookleadads",
    label: "Facebook Lead Ads",
    intake: "trigger",
    events: [
      { type: "facebookleadads.newlead", label: "New Lead" },
    ],
  },
  {
    id: "figma",
    label: "Figma",
    intake: "trigger",
    events: [
      { type: "figma.filecomment", label: "File Commented" },
      { type: "figma.filedelete", label: "File Deleted" },
      { type: "figma.fileupdate", label: "File Updated" },
      { type: "figma.fileversionupdate", label: "File Version Updated" },
      { type: "figma.librarypublish", label: "Library Publish" },
    ],
  },
  {
    id: "flow",
    label: "Flow",
    intake: "trigger",
    events: [
      { type: "flow.triggered", label: "Triggered" },
    ],
  },
  {
    id: "formio",
    label: "Form Io",
    intake: "trigger",
    events: [
      { type: "formio.create", label: "Submission Created" },
      { type: "formio.update", label: "Submission Updated" },
    ],
  },
  {
    id: "formstack",
    label: "Formstack",
    intake: "trigger",
    events: [
      { type: "formstack.triggered", label: "Triggered" },
    ],
  },
  {
    id: "getresponse",
    label: "Get Response",
    intake: "trigger",
    events: [
      { type: "getresponse.subscribe", label: "Customer Subscribed" },
      { type: "getresponse.unsubscribe", label: "Customer Unsubscribed" },
      { type: "getresponse.click", label: "Email Clicked" },
      { type: "getresponse.open", label: "Email Opened" },
      { type: "getresponse.survey", label: "Survey Submitted" },
    ],
  },
  {
    id: "gitlab",
    label: "Gitlab",
    intake: "trigger",
    events: [
      { type: "gitlab.triggered", label: "Triggered" },
    ],
  },
  {
    id: "google",
    label: "Google",
    intake: "poll",
    events: [
      { type: "google.gmail.message.received", label: "Gmail message received" },
      { type: "google.calendar.event.cancelled", label: "Calendar event cancelled" },
      { type: "google.calendar.event.created", label: "Calendar event created" },
      { type: "google.calendar.event.ended", label: "Calendar event ended" },
      { type: "google.calendar.event.started", label: "Calendar event started" },
      { type: "google.calendar.event.updated", label: "Calendar event updated" },
      { type: "google.drive.file.created", label: "Drive file created" },
      { type: "google.drive.file.updated", label: "Drive file updated" },
      { type: "google.drive.folder.created", label: "Drive folder created" },
      { type: "google.drive.folder.updated", label: "Drive folder updated" },
      { type: "google.drive.folder.watch.updated", label: "Drive watched folder updated" },
      { type: "google.sheets.row.added", label: "Sheets row added" },
      { type: "google.sheets.row.updated", label: "Sheets row updated" },
      { type: "google.sheets.row.added_or_updated", label: "Sheets row added or updated" },
      { type: "google.business.review.added", label: "Business Profile review added" },
    ],
  },
  {
    id: "gumroad",
    label: "Gumroad",
    intake: "trigger",
    events: [
      { type: "gumroad.triggered", label: "Triggered" },
    ],
  },
  {
    id: "helpscout",
    label: "Help Scout",
    intake: "trigger",
    events: [
      { type: "helpscout.convo.assigned", label: "Conversation - Assigned" },
      { type: "helpscout.convo.created", label: "Conversation - Created" },
      { type: "helpscout.convo.deleted", label: "Conversation - Deleted" },
      { type: "helpscout.convo.merged", label: "Conversation - Merged" },
      { type: "helpscout.convo.moved", label: "Conversation - Moved" },
      { type: "helpscout.convo.status", label: "Conversation - Status" },
      { type: "helpscout.convo.tags", label: "Conversation - Tags" },
      { type: "helpscout.convo.agent.reply.created", label: "Conversation Agent Reply - Created" },
      { type: "helpscout.convo.customer.reply.created", label: "Conversation Customer Reply - Created" },
      { type: "helpscout.convo.note.created", label: "Conversation Note - Created" },
      { type: "helpscout.customer.created", label: "Customer - Created" },
      { type: "helpscout.satisfaction.ratings", label: "Rating - Received" },
    ],
  },
  {
    id: "hubspot",
    label: "Hubspot",
    intake: "trigger",
    events: [
      { type: "hubspot.company.creation", label: "Company Created" },
      { type: "hubspot.company.deletion", label: "Company Deleted" },
      { type: "hubspot.company.propertychange", label: "Company Property Changed" },
      { type: "hubspot.contact.creation", label: "Contact Created" },
      { type: "hubspot.contact.deletion", label: "Contact Deleted" },
      { type: "hubspot.contact.privacydeletion", label: "Contact Privacy Deleted" },
      { type: "hubspot.contact.propertychange", label: "Contact Property Changed" },
      { type: "hubspot.conversation.creation", label: "Conversation Creation" },
      { type: "hubspot.conversation.deletion", label: "Conversation Deletion" },
      { type: "hubspot.conversation.newmessage", label: "Conversation New Message" },
      { type: "hubspot.conversation.privacydeletion", label: "Conversation Privacy Deletion" },
      { type: "hubspot.conversation.propertychange", label: "Conversation Property Change" },
      { type: "hubspot.deal.creation", label: "Deal Created" },
      { type: "hubspot.deal.deletion", label: "Deal Deleted" },
      { type: "hubspot.deal.propertychange", label: "Deal Property Changed" },
      { type: "hubspot.ticket.creation", label: "Ticket Created" },
      { type: "hubspot.ticket.deletion", label: "Ticket Deleted" },
      { type: "hubspot.ticket.propertychange", label: "Ticket Property Changed" },
      { type: "hubspot.assignedto", label: "Assigned To" },
      { type: "hubspot.isarchived", label: "Is Archived" },
      { type: "hubspot.status", label: "Status" },
    ],
  },
  {
    id: "invoiceninja",
    label: "Invoice Ninja",
    intake: "trigger",
    events: [
      { type: "invoiceninja.create.client", label: "Client Created" },
      { type: "invoiceninja.create.invoice", label: "Invoice Created" },
      { type: "invoiceninja.create.payment", label: "Payment Created" },
      { type: "invoiceninja.create.quote", label: "Quote Created" },
      { type: "invoiceninja.create.vendor", label: "Vendor Created" },
    ],
  },
  {
    id: "jira",
    label: "Jira",
    intake: "poll",
    events: [
      { type: "jira.board.configuration.changed", label: "Board configuration changed" },
      { type: "jira.board.created", label: "Board created" },
      { type: "jira.board.deleted", label: "Board deleted" },
      { type: "jira.board.updated", label: "Board updated" },
      { type: "jira.comment.created", label: "Comment created" },
      { type: "jira.comment.deleted", label: "Comment deleted" },
      { type: "jira.comment.updated", label: "Comment updated" },
      { type: "jira.issue.created", label: "Issue created" },
      { type: "jira.issue.deleted", label: "Issue deleted" },
      { type: "jira.issue.link.created", label: "Issue link created" },
      { type: "jira.issue.link.deleted", label: "Issue link deleted" },
      { type: "jira.issue.property.deleted", label: "Issue property deleted" },
      { type: "jira.issue.property.set", label: "Issue property set" },
      { type: "jira.issue.updated", label: "Issue updated" },
      { type: "jira.option.attachments.changed", label: "Option attachments changed" },
      { type: "jira.option.issuelinks.changed", label: "Option issue links changed" },
      { type: "jira.option.subtasks.changed", label: "Option subtasks changed" },
      { type: "jira.option.timetracking.changed", label: "Option timetracking changed" },
      { type: "jira.option.unassigned.issues.changed", label: "Option unassigned issues changed" },
      { type: "jira.option.voting.changed", label: "Option voting changed" },
      { type: "jira.option.watching.changed", label: "Option watching changed" },
      { type: "jira.project.created", label: "Project created" },
      { type: "jira.project.deleted", label: "Project deleted" },
      { type: "jira.project.updated", label: "Project updated" },
      { type: "jira.sprint.closed", label: "Sprint closed" },
      { type: "jira.sprint.created", label: "Sprint created" },
      { type: "jira.sprint.deleted", label: "Sprint deleted" },
      { type: "jira.sprint.started", label: "Sprint started" },
      { type: "jira.sprint.updated", label: "Sprint updated" },
      { type: "jira.user.created", label: "User created" },
      { type: "jira.user.deleted", label: "User deleted" },
      { type: "jira.user.updated", label: "User updated" },
      { type: "jira.version.created", label: "Version created" },
      { type: "jira.version.deleted", label: "Version deleted" },
      { type: "jira.version.merged", label: "Version merged" },
      { type: "jira.version.moved", label: "Version moved" },
      { type: "jira.version.released", label: "Version released" },
      { type: "jira.version.unreleased", label: "Version unreleased" },
      { type: "jira.version.updated", label: "Version updated" },
      { type: "jira.worklog.created", label: "Worklog created" },
      { type: "jira.worklog.deleted", label: "Worklog deleted" },
      { type: "jira.worklog.updated", label: "Worklog updated" },
    ],
  },
  {
    id: "jotform",
    label: "Jot Form",
    intake: "trigger",
    events: [
      { type: "jotform.triggered", label: "Triggered" },
    ],
  },
  {
    id: "kafka",
    label: "Kafka",
    intake: "trigger",
    events: [
      { type: "kafka.triggered", label: "Triggered" },
    ],
  },
  {
    id: "keap",
    label: "Keap",
    intake: "trigger",
    events: [
      { type: "keap.triggered", label: "Triggered" },
    ],
  },
  {
    id: "kobotoolbox",
    label: "Ko Bo Toolbox",
    intake: "trigger",
    events: [
      { type: "kobotoolbox.formsubmission", label: "On Form Submission" },
    ],
  },
  {
    id: "lemlist",
    label: "Lemlist",
    intake: "trigger",
    events: [
      { type: "lemlist.triggered", label: "Triggered" },
    ],
  },
  {
    id: "linear",
    label: "Linear",
    intake: "poll",
    events: [
      { type: "linear.comment.reaction", label: "Comment reaction" },
      { type: "linear.cycle", label: "Cycle" },
      { type: "linear.issue", label: "Issue" },
      { type: "linear.issue.comment", label: "Issue comment" },
      { type: "linear.issue.label", label: "Issue label" },
      { type: "linear.project", label: "Project" },
    ],
  },
  {
    id: "lonescale",
    label: "Lone Scale",
    intake: "trigger",
    events: [
      { type: "lonescale.triggered", label: "Triggered" },
    ],
  },
  {
    id: "mailchimp",
    label: "Mailchimp",
    intake: "trigger",
    events: [
      { type: "mailchimp.campaign", label: "Campaign Sent" },
      { type: "mailchimp.cleaned", label: "Cleaned" },
      { type: "mailchimp.upemail", label: "Email Address Updated" },
      { type: "mailchimp.profile", label: "Profile Updated" },
      { type: "mailchimp.subscribe", label: "Subscribe" },
      { type: "mailchimp.unsubscribe", label: "Unsubscribe" },
      { type: "mailchimp.user", label: "User" },
      { type: "mailchimp.admin", label: "Admin" },
      { type: "mailchimp.api", label: "API" },
    ],
  },
  {
    id: "mailerlite",
    label: "Mailer Lite",
    intake: "trigger",
    events: [
      { type: "mailerlite.triggered", label: "Triggered" },
    ],
  },
  {
    id: "mailjet",
    label: "Mailjet",
    intake: "trigger",
    events: [
      { type: "mailjet.email.blocked", label: "Email Blocked" },
      { type: "mailjet.email.bounce", label: "Email Bounce" },
      { type: "mailjet.email.open", label: "Email Open" },
      { type: "mailjet.email.sent", label: "Email Sent" },
      { type: "mailjet.email.spam", label: "Email Spam" },
      { type: "mailjet.email.unsub", label: "Email Unsub" },
    ],
  },
  {
    id: "mautic",
    label: "Mautic",
    intake: "trigger",
    events: [
      { type: "mautic.asc", label: "ASC" },
      { type: "mautic.desc", label: "DESC" },
    ],
  },
  {
    id: "mqtt",
    label: "Mqtt",
    intake: "trigger",
    events: [
      { type: "mqtt.triggered", label: "Triggered" },
    ],
  },
  {
    id: "netlify",
    label: "Netlify",
    intake: "trigger",
    events: [
      { type: "netlify.deploybuilding", label: "Deploy Building" },
      { type: "netlify.deployfailed", label: "Deploy Failed" },
      { type: "netlify.deploycreated", label: "Deploy Created" },
      { type: "netlify.submissioncreated", label: "Form Submitted" },
    ],
  },
  {
    id: "notion",
    label: "Notion",
    intake: "poll",
    events: [
      { type: "notion.page.added", label: "Page added to database" },
      { type: "notion.page.updated", label: "Page updated in database" },
    ],
  },
  {
    id: "onedrive",
    label: "OneDrive",
    intake: "trigger",
    events: [
      { type: "onedrive.triggered", label: "Triggered" },
    ],
  },
  {
    id: "onfleet",
    label: "Onfleet",
    intake: "trigger",
    events: [
      { type: "onfleet.triggered", label: "Triggered" },
    ],
  },
  {
    id: "outlook",
    label: "Outlook",
    intake: "poll",
    events: [
      { type: "outlook.message.received", label: "Message received" },
    ],
  },
  {
    id: "paypal",
    label: "Pay Pal",
    intake: "trigger",
    events: [
      { type: "paypal.triggered", label: "Triggered" },
    ],
  },
  {
    id: "pipedrive",
    label: "Pipedrive",
    intake: "trigger",
    events: [
      { type: "pipedrive.triggered", label: "Triggered" },
    ],
  },
  {
    id: "postgres",
    label: "Postgres",
    intake: "trigger",
    events: [
      { type: "postgres.triggered", label: "Triggered" },
    ],
  },
  {
    id: "postmark",
    label: "Postmark",
    intake: "trigger",
    events: [
      { type: "postmark.bounce", label: "Bounce" },
      { type: "postmark.click", label: "Click" },
      { type: "postmark.delivery", label: "Delivery" },
      { type: "postmark.open", label: "Open" },
      { type: "postmark.spamcomplaint", label: "Spam Complaint" },
      { type: "postmark.subscriptionchange", label: "Subscription Change" },
    ],
  },
  {
    id: "pushcut",
    label: "Pushcut",
    intake: "trigger",
    events: [
      { type: "pushcut.triggered", label: "Triggered" },
    ],
  },
  {
    id: "rabbitmq",
    label: "Rabbit MQ",
    intake: "trigger",
    events: [
      { type: "rabbitmq.triggered", label: "Triggered" },
    ],
  },
  {
    id: "redis",
    label: "Redis",
    intake: "trigger",
    events: [
      { type: "redis.triggered", label: "Triggered" },
    ],
  },
  {
    id: "rss",
    label: "RSS",
    intake: "poll",
    events: [
      { type: "rss.triggered", label: "Triggered" },
    ],
  },
  {
    id: "salesforce",
    label: "Salesforce",
    intake: "trigger",
    events: [
      { type: "salesforce.accountcreated", label: "Account Created" },
      { type: "salesforce.accountupdated", label: "Account Updated" },
      { type: "salesforce.attachmentcreated", label: "Attachment Created" },
      { type: "salesforce.attachmentupdated", label: "Attachment Updated" },
      { type: "salesforce.casecreated", label: "Case Created" },
      { type: "salesforce.caseupdated", label: "Case Updated" },
      { type: "salesforce.contactcreated", label: "Contact Created" },
      { type: "salesforce.contactupdated", label: "Contact Updated" },
      { type: "salesforce.customobjectcreated", label: "Custom Object Created" },
      { type: "salesforce.customobjectupdated", label: "Custom Object Updated" },
      { type: "salesforce.leadcreated", label: "Lead Created" },
      { type: "salesforce.leadupdated", label: "Lead Updated" },
      { type: "salesforce.opportunitycreated", label: "Opportunity Created" },
      { type: "salesforce.opportunityupdated", label: "Opportunity Updated" },
      { type: "salesforce.taskcreated", label: "Task Created" },
      { type: "salesforce.taskupdated", label: "Task Updated" },
      { type: "salesforce.usercreated", label: "User Created" },
      { type: "salesforce.userupdated", label: "User Updated" },
    ],
  },
  {
    id: "seatable",
    label: "Sea Table",
    intake: "trigger",
    events: [
      { type: "seatable.triggered", label: "Triggered" },
    ],
  },
  {
    id: "shopify",
    label: "Shopify",
    intake: "trigger",
    events: [
      { type: "shopify.triggered", label: "Triggered" },
    ],
  },
  {
    id: "slack",
    label: "Slack",
    intake: "webhook",
    events: [
      { type: "slack.app.home.opened", label: "App Home opened" },
      { type: "slack.app.mention", label: "Bot / App mention" },
      { type: "slack.file.public", label: "File made public" },
      { type: "slack.file.share", label: "File shared" },
      { type: "slack.message", label: "New message posted to channel" },
      { type: "slack.channel.created", label: "New public channel created" },
      { type: "slack.team.join", label: "New user" },
      { type: "slack.reaction.added", label: "Reaction added" },
    ],
  },
  {
    id: "strava",
    label: "Strava",
    intake: "trigger",
    events: [
      { type: "strava.create", label: "Created" },
      { type: "strava.delete", label: "Deleted" },
      { type: "strava.update", label: "Updated" },
    ],
  },
  {
    id: "stripe",
    label: "Stripe",
    intake: "poll",
    events: [
      { type: "stripe.account.updated", label: "Account Updated" },
      { type: "stripe.account.application.authorized", label: "Account Application.authorized" },
      { type: "stripe.account.application.deauthorized", label: "Account Application.deauthorized" },
      { type: "stripe.account.external.account.created", label: "Account External_account.created" },
      { type: "stripe.account.external.account.deleted", label: "Account External_account.deleted" },
      { type: "stripe.account.external.account.updated", label: "Account External_account.updated" },
      { type: "stripe.application.fee.created", label: "Application Fee.created" },
      { type: "stripe.application.fee.refunded", label: "Application Fee.refunded" },
      { type: "stripe.application.fee.refund.updated", label: "Application Fee.refund.updated" },
      { type: "stripe.balance.available", label: "Balance Available" },
      { type: "stripe.capability.updated", label: "Capability Updated" },
      { type: "stripe.charge.captured", label: "Charge Captured" },
      { type: "stripe.charge.expired", label: "Charge Expired" },
      { type: "stripe.charge.failed", label: "Charge Failed" },
      { type: "stripe.charge.pending", label: "Charge Pending" },
      { type: "stripe.charge.refunded", label: "Charge Refunded" },
      { type: "stripe.charge.succeeded", label: "Charge Succeeded" },
      { type: "stripe.charge.updated", label: "Charge Updated" },
      { type: "stripe.charge.dispute.closed", label: "Charge Dispute.closed" },
      { type: "stripe.charge.dispute.created", label: "Charge Dispute.created" },
      { type: "stripe.charge.dispute.funds.reinstated", label: "Charge Dispute.funds_reinstated" },
      { type: "stripe.charge.dispute.funds.withdrawn", label: "Charge Dispute.funds_withdrawn" },
      { type: "stripe.charge.dispute.updated", label: "Charge Dispute.updated" },
      { type: "stripe.charge.refund.updated", label: "Charge Refund.updated" },
      { type: "stripe.checkout.session.completed", label: "Checkout Session.completed" },
      { type: "stripe.coupon.created", label: "Coupon Created" },
      { type: "stripe.coupon.deleted", label: "Coupon Deleted" },
      { type: "stripe.coupon.updated", label: "Coupon Updated" },
      { type: "stripe.credit.note.created", label: "Credit Note.created" },
      { type: "stripe.credit.note.updated", label: "Credit Note.updated" },
      { type: "stripe.credit.note.voided", label: "Credit Note.voided" },
      { type: "stripe.customer.created", label: "Customer Created" },
      { type: "stripe.customer.deleted", label: "Customer Deleted" },
      { type: "stripe.customer.updated", label: "Customer Updated" },
      { type: "stripe.customer.discount.created", label: "Customer Discount.created" },
      { type: "stripe.customer.discount.deleted", label: "Customer Discount.deleted" },
      { type: "stripe.customer.discount.updated", label: "Customer Discount.updated" },
      { type: "stripe.customer.source.created", label: "Customer Source.created" },
      { type: "stripe.customer.source.deleted", label: "Customer Source.deleted" },
      { type: "stripe.customer.source.expiring", label: "Customer Source.expiring" },
      { type: "stripe.customer.source.updated", label: "Customer Source.updated" },
      { type: "stripe.customer.subscription.created", label: "Customer Subscription.created" },
      { type: "stripe.customer.subscription.deleted", label: "Customer Subscription.deleted" },
      { type: "stripe.customer.subscription.trial.will.end", label: "Customer Subscription.trial_will_end" },
    ],
  },
  {
    id: "surveymonkey",
    label: "Survey Monkey",
    intake: "trigger",
    events: [
      { type: "surveymonkey.collector.created", label: "Collector Created" },
      { type: "surveymonkey.collector.deleted", label: "Collector Deleted" },
      { type: "surveymonkey.collector.updated", label: "Collector Updated" },
      { type: "surveymonkey.response.completed", label: "Response Completed" },
      { type: "surveymonkey.response.created", label: "Response Created" },
      { type: "surveymonkey.response.deleted", label: "Response Deleted" },
      { type: "surveymonkey.response.disqualified", label: "Response Disqualified" },
      { type: "surveymonkey.response.overquota", label: "Response Overquota" },
      { type: "surveymonkey.response.updated", label: "Response Updated" },
      { type: "surveymonkey.survey.created", label: "Survey Created" },
      { type: "surveymonkey.survey.deleted", label: "Survey Deleted" },
      { type: "surveymonkey.survey.updated", label: "Survey Updated" },
    ],
  },
  {
    id: "taiga",
    label: "Taiga",
    intake: "trigger",
    events: [
      { type: "taiga.triggered", label: "Triggered" },
    ],
  },
  {
    id: "teams",
    label: "Teams",
    intake: "trigger",
    events: [
      { type: "teams.newchannel", label: "New Channel" },
      { type: "teams.newchannelmessage", label: "New Channel Message" },
      { type: "teams.newchat", label: "New Chat" },
      { type: "teams.newchatmessage", label: "New Chat Message" },
      { type: "teams.newteammember", label: "New Team Member" },
    ],
  },
  {
    id: "telegram",
    label: "Telegram",
    intake: "trigger",
    events: [
      { type: "telegram.callback.query", label: "Callback Query" },
      { type: "telegram.channel.post", label: "Channel Post" },
      { type: "telegram.edited.channel.post", label: "Edited Channel Post" },
      { type: "telegram.edited.message", label: "Edited Message" },
      { type: "telegram.inline.query", label: "Inline Query" },
      { type: "telegram.message", label: "Message" },
      { type: "telegram.poll", label: "Poll" },
      { type: "telegram.pre.checkout.query", label: "Pre-Checkout Query" },
      { type: "telegram.shipping.query", label: "Shipping Query" },
      { type: "telegram.small", label: "Small" },
      { type: "telegram.medium", label: "Medium" },
      { type: "telegram.large", label: "Large" },
      { type: "telegram.extralarge", label: "Extra Large" },
    ],
  },
  {
    id: "thehive",
    label: "The Hive",
    intake: "trigger",
    events: [
      { type: "thehive.triggered", label: "Triggered" },
    ],
  },
  {
    id: "thehive5",
    label: "TheHive 5",
    intake: "trigger",
    events: [
      { type: "thehive5.alert.create", label: "Alert Created" },
      { type: "thehive5.alert.delete", label: "Alert Deleted" },
      { type: "thehive5.alert.update", label: "Alert Updated" },
      { type: "thehive5.case.create", label: "Case Created" },
      { type: "thehive5.case.delete", label: "Case Deleted" },
      { type: "thehive5.case.update", label: "Case Updated" },
      { type: "thehive5.comment.create", label: "Comment Created" },
      { type: "thehive5.comment.delete", label: "Comment Deleted" },
      { type: "thehive5.comment.update", label: "Comment Updated" },
      { type: "thehive5.observable.create", label: "Observable Created" },
      { type: "thehive5.observable.delete", label: "Observable Deleted" },
      { type: "thehive5.observable.update", label: "Observable Updated" },
      { type: "thehive5.page.create", label: "Page Created" },
      { type: "thehive5.page.delete", label: "Page Deleted" },
      { type: "thehive5.page.update", label: "Page Updated" },
      { type: "thehive5.task.create", label: "Task Created" },
      { type: "thehive5.task.update", label: "Task Updated" },
      { type: "thehive5.log.create", label: "Task Log Created" },
      { type: "thehive5.log.delete", label: "Task Log Deleted" },
      { type: "thehive5.log.update", label: "Task Log Updated" },
      { type: "thehive5.equal", label: "Equal" },
      { type: "thehive5.notequal", label: "Not Equal" },
      { type: "thehive5.includes", label: "Includes" },
    ],
  },
  {
    id: "toggl",
    label: "Toggl",
    intake: "trigger",
    events: [
      { type: "toggl.newtimeentry", label: "New Time Entry" },
    ],
  },
  {
    id: "trello",
    label: "Trello",
    intake: "trigger",
    events: [
      { type: "trello.triggered", label: "Triggered" },
    ],
  },
  {
    id: "twilio",
    label: "Twilio",
    intake: "trigger",
    events: [
      { type: "twilio.com.twilio.messaging.inbound.message.received", label: "New SMS" },
      { type: "twilio.com.twilio.voice.insights.call.summary.complete", label: "New Call" },
    ],
  },
  {
    id: "typeform",
    label: "Typeform",
    intake: "trigger",
    events: [
      { type: "typeform.triggered", label: "Triggered" },
    ],
  },
  {
    id: "venafi.cloud",
    label: "Venafi Tls Protect Cloud",
    intake: "trigger",
    events: [
      { type: "venafi.cloud.triggered", label: "Triggered" },
    ],
  },
  {
    id: "venafi.datacenter",
    label: "Venafi Tls Protect Datacenter",
    intake: "trigger",
    events: [
      { type: "venafi.datacenter.certificateexpired", label: "Certificate Expired" },
    ],
  },
  {
    id: "webex",
    label: "Webex",
    intake: "trigger",
    events: [
      { type: "webex.triggered", label: "Triggered" },
    ],
  },
  {
    id: "webflow",
    label: "Webflow",
    intake: "trigger",
    events: [
      { type: "webflow.triggered", label: "Triggered" },
    ],
  },
  {
    id: "whatsapp",
    label: "Whats App",
    intake: "trigger",
    events: [
      { type: "whatsapp.account.review.update", label: "Account Review Update" },
      { type: "whatsapp.account.update", label: "Account Update" },
      { type: "whatsapp.business.capability.update", label: "Business Capability Update" },
      { type: "whatsapp.message.template.quality.update", label: "Message Template Quality Update" },
      { type: "whatsapp.message.template.status.update", label: "Message Template Status Update" },
      { type: "whatsapp.messages", label: "Messages" },
      { type: "whatsapp.phone.number.name.update", label: "Phone Number Name Update" },
      { type: "whatsapp.phone.number.quality.update", label: "Phone Number Quality Update" },
      { type: "whatsapp.security", label: "Security" },
      { type: "whatsapp.template.category.update", label: "Template Category Update" },
      { type: "whatsapp.all", label: "All" },
      { type: "whatsapp.deleted", label: "Deleted" },
      { type: "whatsapp.delivered", label: "Delivered" },
      { type: "whatsapp.failed", label: "Failed" },
      { type: "whatsapp.read", label: "Read" },
      { type: "whatsapp.sent", label: "Sent" },
    ],
  },
  {
    id: "wise",
    label: "Wise",
    intake: "trigger",
    events: [
      { type: "wise.balancecredit", label: "Balance Credit" },
      { type: "wise.balanceupdate", label: "Balance Update" },
      { type: "wise.transferactivecases", label: "Transfer Active Case" },
      { type: "wise.tranferstatechange", label: "Transfer State Changed" },
    ],
  },
  {
    id: "woocommerce",
    label: "Woo Commerce",
    intake: "trigger",
    events: [
      { type: "woocommerce.coupon.created", label: "Coupon Created" },
      { type: "woocommerce.coupon.deleted", label: "Coupon Deleted" },
      { type: "woocommerce.coupon.updated", label: "Coupon Updated" },
      { type: "woocommerce.customer.created", label: "Customer Created" },
      { type: "woocommerce.customer.deleted", label: "Customer Deleted" },
      { type: "woocommerce.customer.updated", label: "Customer Updated" },
      { type: "woocommerce.order.created", label: "Order Created" },
      { type: "woocommerce.order.deleted", label: "Order Deleted" },
      { type: "woocommerce.order.updated", label: "Order Updated" },
      { type: "woocommerce.product.created", label: "Product Created" },
      { type: "woocommerce.product.deleted", label: "Product Deleted" },
      { type: "woocommerce.product.updated", label: "Product Updated" },
    ],
  },
  {
    id: "workable",
    label: "Workable",
    intake: "trigger",
    events: [
      { type: "workable.candidatecreated", label: "Candidate Created" },
      { type: "workable.candidatemoved", label: "Candidate Moved" },
    ],
  },
  {
    id: "wufoo",
    label: "Wufoo",
    intake: "trigger",
    events: [
      { type: "wufoo.triggered", label: "Triggered" },
    ],
  },
  {
    id: "zendesk",
    label: "Zendesk",
    intake: "trigger",
    events: [
      { type: "zendesk.triggered", label: "Triggered" },
    ],
  },
];

export function listConnectors(): readonly Connector[] {
  const copy: Connector[] = [];
  for (const connector of CONNECTORS) {
    copy.push(connector);
  }
  return copy;
}

export function connectorById(id: string): Connector[] {
  const hits: Connector[] = [];
  for (const connector of CONNECTORS) {
    if (connector.id === id) {
      hits.push(connector);
    }
  }
  return hits;
}

export function connectorEventTypes(): string[] {
  const types: string[] = [];
  for (const connector of CONNECTORS) {
    for (const listed of connector.events) {
      types.push(listed.type);
    }
  }
  return types;
}

export function isConnectorEventType(eventType: string): boolean {
  for (const listed of connectorEventTypes()) {
    if (listed === eventType) {
      return true;
    }
  }
  return false;
}

export function connectorEmits(id: string, eventType: string): boolean {
  const hits = connectorById(id);
  for (const connector of hits) {
    for (const listed of connector.events) {
      if (listed.type === eventType) {
        return true;
      }
    }
  }
  return false;
}

export function requireConnectorEvent(id: string, eventType: string): void {
  if (eventType.length === 0) {
    throw new Error("connector event type required");
  }
  if (connectorById(id).length === 0) {
    throw new Error(`unknown connector ${id}`);
  }
  if (connectorEmits(id, eventType) !== true) {
    throw new Error(`connector ${id} does not emit ${eventType}`);
  }
}

export function connectionEventsFor(connectedIds: readonly ConnectorKind[]): ListedConnectionEvent[] {
  const rows: ListedConnectionEvent[] = [];
  for (const connector of CONNECTORS) {
    let connected = false;
    for (const id of connectedIds) {
      if (id === connector.id) {
        connected = true;
      }
    }
    if (connected !== true) {
      continue;
    }
    for (const listed of connector.events) {
      rows.push({
        type: listed.type,
        label: listed.label,
        sourceId: connector.id,
        sourceLabel: connector.label,
      });
    }
  }
  return rows;
}

export function connectorOwnsEvent(eventType: string, connectedIds: readonly ConnectorKind[]): boolean {
  for (const id of connectedIds) {
    if (connectorEmits(id, eventType) === true) {
      return true;
    }
  }
  return false;
}
