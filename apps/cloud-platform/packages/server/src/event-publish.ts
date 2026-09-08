import { z } from "zod";
import {
  CLOCK_INTERVAL_TYPES,
  EVENT_APP_STARTED,
  EVENT_FILE_CHANGED,
  EVENT_NOTE_BOOK_CREATED,
  EVENT_NOTE_PAGE_CREATED,
  EVENT_SCRIPT_RAN,
  EVENT_TASK_CREATED,
  EVENT_VOICE_BATCH,
  EVENT_VOICE_SEGMENT,
  EVENT_AGENT_RAN,
  EVENT_INGEST_ALARM,
  isClockEventType,
  isMintedEventType,
  isBusEventType,
  canonicalBusEventType,
  type LotaruEvent,
} from "./events.js";
import { isConnectorEventType } from "./connector-catalog.js";

export type StoredEventFields = {
  type: string;
  projectId: string;
  scriptId: string;
  path: string;
  detail: string;
};

const projectIdSchema = z.string().min(1);

const clockPublishSchema = z
  .object({
    type: z.enum(CLOCK_INTERVAL_TYPES),
    projectId: projectIdSchema,
  })
  .strict();

const filePublishSchema = z
  .object({
    type: z.literal(EVENT_FILE_CHANGED),
    projectId: projectIdSchema,
    path: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

const appStartedPublishSchema = z
  .object({
    type: z.literal(EVENT_APP_STARTED),
    projectId: projectIdSchema,
    detail: z.string().min(1),
  })
  .strict();

const taskCreatedPublishSchema = z
  .object({
    type: z.literal(EVENT_TASK_CREATED),
    projectId: projectIdSchema,
    path: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

const noteBookPublishSchema = z
  .object({
    type: z.literal(EVENT_NOTE_BOOK_CREATED),
    projectId: projectIdSchema,
    path: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

const notePagePublishSchema = z
  .object({
    type: z.literal(EVENT_NOTE_PAGE_CREATED),
    projectId: projectIdSchema,
    path: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

const voiceSegmentPublishSchema = z
  .object({
    type: z.literal(EVENT_VOICE_SEGMENT),
    projectId: projectIdSchema,
    path: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

const voiceBatchPublishSchema = z
  .object({
    type: z.literal(EVENT_VOICE_BATCH),
    projectId: projectIdSchema,
    path: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

const scriptRanPublishSchema = z
  .object({
    type: z.literal(EVENT_SCRIPT_RAN),
    projectId: projectIdSchema,
    scriptId: z.string().min(1),
    path: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

const connectorPublishSchema = z
  .object({
    type: z.string().min(1),
    projectId: projectIdSchema,
    path: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict()
  .refine((row) => isConnectorEventType(row.type), { message: "not a connector event type" });

const agentRanPublishSchema = z
  .object({
    type: z.literal(EVENT_AGENT_RAN),
    projectId: projectIdSchema,
    path: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

const ingestAlarmPublishSchema = z
  .object({
    type: z.literal(EVENT_INGEST_ALARM),
    projectId: projectIdSchema,
    path: z.enum(["ok", "behind", "poll_error", "tunnel_down"]),
    detail: z.string().min(1),
  })
  .strict();

const platformPublishSchema = z.union([
  clockPublishSchema,
  filePublishSchema,
  appStartedPublishSchema,
  taskCreatedPublishSchema,
  noteBookPublishSchema,
  notePagePublishSchema,
  voiceSegmentPublishSchema,
  voiceBatchPublishSchema,
  scriptRanPublishSchema,
  agentRanPublishSchema,
  ingestAlarmPublishSchema,
]);

const mintedPublishSchema = z
  .object({
    type: z.string().min(1),
    projectId: projectIdSchema,
    path: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict()
  .refine((row) => isMintedEventType(row.type), { message: "not a minted event type" });

export type LotaruPublishInput =
  | z.infer<typeof platformPublishSchema>
  | z.infer<typeof connectorPublishSchema>
  | z.infer<typeof mintedPublishSchema>;

export function parseLotaruPublish(input: unknown): LotaruPublishInput {
  const platform = platformPublishSchema.safeParse(input);
  if (platform.success === true) {
    return platform.data;
  }
  const connector = connectorPublishSchema.safeParse(input);
  if (connector.success === true) {
    return connector.data;
  }
  const minted = mintedPublishSchema.safeParse(input);
  if (minted.success === true) {
    return minted.data;
  }
  throw new Error("invalid Lotaru publish payload");
}

export function storedEnvelopeFromPublish(input: LotaruPublishInput): StoredEventFields {
  const parsed = parseLotaruPublish(input);
  let scriptId = "";
  let path = "";
  let detail = "";
  if ("scriptId" in parsed) {
    scriptId = parsed.scriptId;
  }
  if ("path" in parsed) {
    path = parsed.path;
  }
  if ("detail" in parsed) {
    detail = parsed.detail;
  }
  return {
    type: parsed.type,
    projectId: parsed.projectId,
    scriptId,
    path,
    detail,
  };
}

function candidateRecordFromStored(stored: LotaruEvent): unknown {
  const type = canonicalBusEventType(stored.type);
  const projectId = stored.projectId;
  if (isClockEventType(type)) {
    return { type, projectId };
  }
  if (type === EVENT_APP_STARTED) {
    return { type: EVENT_APP_STARTED, projectId, detail: stored.detail };
  }
  if (type === EVENT_INGEST_ALARM) {
    return {
      type: EVENT_INGEST_ALARM,
      projectId,
      path: stored.path,
      detail: stored.detail,
    };
  }
  if (type === EVENT_SCRIPT_RAN) {
    return {
      type: EVENT_SCRIPT_RAN,
      projectId,
      scriptId: stored.scriptId,
      path: stored.path,
      detail: stored.detail,
    };
  }
  return {
    type,
    projectId,
    path: stored.path,
    detail: stored.detail,
  };
}

export function publishInputFromStored(stored: LotaruEvent): LotaruPublishInput[] {
  if (isBusEventType(stored.type) !== true) {
    return [];
  }
  try {
    return [parseLotaruPublish(candidateRecordFromStored(stored))];
  } catch {
    return [];
  }
}

export function replayPayloadsFromStored(stored: LotaruEvent): LotaruPublishInput[] {
  return publishInputFromStored(stored);
}
