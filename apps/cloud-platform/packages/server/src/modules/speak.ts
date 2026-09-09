import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { userCanAccessProject } from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { loadAppSettings, openSettingsDb } from "../app-settings.js";
import {
  enqueueSpeakUtterance,
  failSpeakUtterance,
  getSpeakUtterance,
  listSpeakPlayable,
  listSpeakUtterances,
  loadSpeakAudio,
  markSpeakPlayed,
  saveSpeakAudio,
  SPEAK_ALREADY_FAILED,
  SPEAK_QUEUE_FULL,
  sourceSchema,
  statusSchema,
  type SpeakSource,
  type SpeakStatus,
  type SpeakUtterance,
} from "../speak-store.js";
import { synthesizeSpeech } from "../tts.js";
import type { Identity } from "./identity.js";

type SpeakOptions = {
  databasePath: string;
  identity: Identity;
  projectAccess?: (projectId: string, userId: string) => boolean;
  synthesize?: (text: string, language: string) => Promise<Buffer>;
};

const createBodySchema = z
  .object({
    projectId: z.string().trim().min(1),
    text: z.string().trim().min(1),
    source: sourceSchema.optional(),
  })
  .strict();

const listQuerySchema = z.object({
  projectId: z.string().trim().min(1),
  status: statusSchema.optional(),
  playable: z.enum(["1", "true"]).optional(),
});

const utteranceIdParamsSchema = z.object({
  utteranceId: z.string().trim().min(1),
});

function canSeeProject(options: SpeakOptions, projectId: string, userId: string): boolean {
  if (options.projectAccess !== undefined) {
    return options.projectAccess(projectId, userId);
  }
  return userCanAccessProject(projectId, userId);
}

function loadVisibleUtterance(
  options: SpeakOptions,
  rawId: string,
  userId: string,
): SpeakUtterance[] {
  const parsed = utteranceIdParamsSchema.safeParse({ utteranceId: rawId });
  if (parsed.success !== true) {
    return [];
  }
  const utterance = getSpeakUtterance(options.databasePath, parsed.data.utteranceId);
  if (utterance === undefined) {
    return [];
  }
  if (canSeeProject(options, utterance.projectId, userId) !== true) {
    return [];
  }
  return [utterance];
}

async function viewerId(request: FastifyRequest, options: SpeakOptions): Promise<string> {
  const user = await options.identity.userFrom(request);
  if (user === null) {
    return "";
  }
  return user.id;
}

function replyMissing(): { error: string } {
  return { error: "not found" };
}

async function utteranceFromRequest(
  request: FastifyRequest<{ Params: { utteranceId: string } }>,
  reply: FastifyReply,
  options: SpeakOptions,
): Promise<SpeakUtterance[]> {
  const userId = await viewerId(request, options);
  if (userId.length === 0) {
    await reply.code(401).send({ error: "unauthorized" });
    return [];
  }
  const hits = loadVisibleUtterance(options, request.params.utteranceId, userId);
  if (hits.length === 0) {
    await reply.code(404).send(replyMissing());
    return [];
  }
  return hits;
}

function failureMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const text = err.message.trim();
    if (text.length > 0) {
      return text;
    }
  }
  return fallback;
}

async function synthesizeUtterance(
  options: SpeakOptions,
  utterance: SpeakUtterance,
  settingsDb: ReturnType<typeof openSettingsDb>,
): Promise<Buffer> {
  const cached = loadSpeakAudio(options.databasePath, utterance.id);
  if (cached !== undefined) {
    return cached;
  }
  const settings = loadAppSettings(settingsDb);
  try {
    let audio: Buffer;
    if (options.synthesize !== undefined) {
      audio = await options.synthesize(utterance.text, settings.targetLanguage);
    } else {
      audio = await synthesizeSpeech(settings, utterance.text, settings.targetLanguage);
    }
    saveSpeakAudio(options.databasePath, utterance.id, audio);
    return audio;
  } catch (err) {
    failSpeakUtterance(options.databasePath, utterance.id, failureMessage(err, "Speech failed"));
    throw err;
  }
}

async function audioForUtterance(
  options: SpeakOptions,
  utterance: SpeakUtterance,
  inflight: Map<string, Promise<Buffer>>,
  settingsDb: ReturnType<typeof openSettingsDb>,
): Promise<Buffer> {
  const cached = loadSpeakAudio(options.databasePath, utterance.id);
  if (cached !== undefined) {
    return cached;
  }
  const pending = inflight.get(utterance.id);
  if (pending !== undefined) {
    return pending;
  }
  const job = synthesizeUtterance(options, utterance, settingsDb);
  inflight.set(utterance.id, job);
  try {
    return await job;
  } finally {
    inflight.delete(utterance.id);
  }
}

export async function registerSpeakModule(
  app: FastifyInstance,
  options: SpeakOptions,
): Promise<void> {
  const inflight = new Map<string, Promise<Buffer>>();
  const settingsDb = openSettingsDb(options.databasePath);
  app.addHook("onClose", async () => {
    if (settingsDb.open) {
      settingsDb.close();
    }
  });

  app.get("/api/speak", async (request, reply) => {
    const userId = await viewerId(request, options);
    if (userId.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = listQuerySchema.safeParse(request.query);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "project required" });
    }
    if (parsed.data.playable !== undefined && parsed.data.status !== undefined) {
      return reply.code(400).send({ error: "invalid query" });
    }
    if (canSeeProject(options, parsed.data.projectId, userId) !== true) {
      return reply.code(404).send(replyMissing());
    }
    let utterances: SpeakUtterance[] = [];
    if (parsed.data.playable !== undefined) {
      utterances = listSpeakPlayable(options.databasePath, parsed.data.projectId);
    } else {
      let status: SpeakStatus | undefined;
      if (parsed.data.status !== undefined) {
        status = parsed.data.status;
      }
      utterances = listSpeakUtterances(options.databasePath, parsed.data.projectId, status);
    }
    return { utterances };
  });

  app.post("/api/speak", async (request, reply) => {
    const userId = await viewerId(request, options);
    if (userId.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = createBodySchema.safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "text required" });
    }
    if (canSeeProject(options, parsed.data.projectId, userId) !== true) {
      return reply.code(404).send(replyMissing());
    }
    let source: SpeakSource = "ui";
    if (parsed.data.source !== undefined) {
      source = parsed.data.source;
    }
    try {
      const utterance = enqueueSpeakUtterance(options.databasePath, {
        projectId: parsed.data.projectId,
        text: parsed.data.text,
        source,
        createdBy: userId,
      });
      return reply.code(201).send(utterance);
    } catch (err) {
      const message = failureMessage(err, "text required");
      if (message === SPEAK_QUEUE_FULL) {
        return reply.code(409).send({ error: message });
      }
      return reply.code(400).send({ error: message });
    }
  });

  app.get<{ Params: { utteranceId: string } }>(
    "/api/speak/:utteranceId",
    async (request, reply) => {
      const hits = await utteranceFromRequest(request, reply, options);
      let utterance: SpeakUtterance | undefined;
      for (const hit of hits) {
        utterance = hit;
      }
      if (utterance === undefined) {
        return;
      }
      return utterance;
    },
  );

  app.get<{ Params: { utteranceId: string } }>(
    "/api/speak/:utteranceId/audio",
    async (request, reply) => {
      const hits = await utteranceFromRequest(request, reply, options);
      let utterance: SpeakUtterance | undefined;
      for (const hit of hits) {
        utterance = hit;
      }
      if (utterance === undefined) {
        return;
      }
      try {
        const audio = await audioForUtterance(options, utterance, inflight, settingsDb);
        return reply
          .header("Cache-Control", "private, max-age=86400")
          .type("audio/mpeg")
          .send(audio);
      } catch (err) {
        return reply.code(502).send({ error: failureMessage(err, "Speech failed") });
      }
    },
  );

  app.post<{ Params: { utteranceId: string } }>(
    "/api/speak/:utteranceId/played",
    async (request, reply) => {
      const hits = await utteranceFromRequest(request, reply, options);
      let utterance: SpeakUtterance | undefined;
      for (const hit of hits) {
        utterance = hit;
      }
      if (utterance === undefined) {
        return;
      }
      try {
        return markSpeakPlayed(options.databasePath, utterance.id);
      } catch (err) {
        const message = failureMessage(err, "Speak already failed");
        if (message === SPEAK_ALREADY_FAILED) {
          return reply.code(409).send({ error: message });
        }
        return reply.code(400).send({ error: message });
      }
    },
  );
}
