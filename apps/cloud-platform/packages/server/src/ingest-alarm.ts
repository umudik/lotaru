import { z } from "zod";

const tunnelStateSchema = z.enum(["off", "starting", "up", "missing_binary", "error"]);

export type IngestAlarmKind = "ok" | "behind" | "poll_error" | "tunnel_down";

export type IngestAlarm = {
  kind: IngestAlarmKind;
  title: string;
  detail: string;
  connectors: string[];
};

export type IngestAlarmPoll = {
  connector: string;
  lastError: string;
  lagged: boolean;
};

export function emptyIngestAlarm(): IngestAlarm {
  return {
    kind: "ok",
    title: "",
    detail: "",
    connectors: [],
  };
}

function pushUnique(listed: string[], connector: string): string[] {
  for (const existing of listed) {
    if (existing === connector) {
      return listed;
    }
  }
  return listed.concat([connector]);
}

function connectorList(polls: readonly IngestAlarmPoll[]): { errors: string[]; lagged: string[] } {
  let errors: string[] = [];
  let lagged: string[] = [];
  for (const row of polls) {
    if (row.lastError.length > 0) {
      errors = pushUnique(errors, row.connector);
    }
    if (row.lagged) {
      lagged = pushUnique(lagged, row.connector);
    }
  }
  return { errors, lagged };
}

function firstErrorDetail(polls: readonly IngestAlarmPoll[]): string {
  for (const row of polls) {
    if (row.lastError.length > 0) {
      return row.lastError;
    }
  }
  return "A connected tool poll failed.";
}

export function ingestAlarmFrom(input: {
  polls: readonly IngestAlarmPoll[];
  tunnelEnabled: boolean;
  tunnelState: string;
}): IngestAlarm {
  const listed = connectorList(input.polls);
  const state = tunnelStateSchema.safeParse(input.tunnelState);
  if (listed.errors.length > 0) {
    return {
      kind: "poll_error",
      title: "Poll failed",
      detail: firstErrorDetail(input.polls),
      connectors: listed.errors,
    };
  }
  if (input.tunnelEnabled === true && state.success === true) {
    if (state.data === "error" || state.data === "missing_binary" || state.data === "off") {
      return {
        kind: "tunnel_down",
        title: "Webhook tunnel is down",
        detail: "Inbound hooks will miss until the tunnel is live. Poll still drains a backlog.",
        connectors: listed.lagged,
      };
    }
  }
  if (input.tunnelEnabled === true && state.success !== true) {
    return {
      kind: "tunnel_down",
      title: "Webhook tunnel is down",
      detail: "Inbound hooks will miss until the tunnel is live. Poll still drains a backlog.",
      connectors: listed.lagged,
    };
  }
  if (listed.lagged.length > 0) {
    return {
      kind: "behind",
      title: "Catch-up is behind",
      detail: "Lotaru is draining the backlog a page at a time. This is not silent skip.",
      connectors: listed.lagged,
    };
  }
  return emptyIngestAlarm();
}

export function ingestAlarmLogDetail(alarm: IngestAlarm): string {
  if (alarm.kind === "ok") {
    return "Catch-up is healthy.";
  }
  if (alarm.connectors.length === 0) {
    return `${alarm.title} ${alarm.detail}`;
  }
  let names = "";
  for (const connector of alarm.connectors) {
    if (names.length === 0) {
      names = connector;
      continue;
    }
    names = `${names}, ${connector}`;
  }
  return `${alarm.title} ${alarm.detail} ${names}`;
}

export function ingestAlarmLogEvents(
  previousKind: IngestAlarmKind,
  alarm: IngestAlarm,
  projectIds: readonly string[],
): { projectId: string; path: IngestAlarmKind; detail: string }[] {
  const listed: { projectId: string; path: IngestAlarmKind; detail: string }[] = [];
  if (previousKind === alarm.kind) {
    return listed;
  }
  const detail = ingestAlarmLogDetail(alarm);
  for (const projectId of projectIds) {
    if (projectId.length === 0) {
      continue;
    }
    listed.push({
      projectId,
      path: alarm.kind,
      detail,
    });
  }
  return listed;
}
