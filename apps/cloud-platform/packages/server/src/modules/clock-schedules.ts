import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createClockSchedule,
  deleteClockSchedule,
  getClockSchedule,
  listClockSchedules,
  openClockScheduleDb,
  patchClockSchedule,
} from "../clock-schedule.js";
import type { Identity } from "./identity.js";

type ClockSchedulesOptions = {
  databasePath: string;
  identity: Identity;
};

const createBodySchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    cron: z.string().trim().min(1),
  })
  .strict();

const patchBodySchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    cron: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

function replyError(err: unknown, fallback: string): { error: string } {
  if (err instanceof Error) {
    const text = err.message.trim();
    if (text.length > 0) {
      return { error: text };
    }
  }
  return { error: fallback };
}

export async function registerClockSchedulesModule(
  app: FastifyInstance,
  options: ClockSchedulesOptions,
): Promise<void> {
  const db = openClockScheduleDb(options.databasePath);

  app.get("/api/clock-schedules", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return { schedules: listClockSchedules(db) };
  });

  app.post("/api/clock-schedules", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = createBodySchema.safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "Invalid clock time" });
    }
    try {
      const schedule = createClockSchedule(db, parsed.data.title, parsed.data.cron);
      return reply.code(201).send(schedule);
    } catch (err) {
      return reply.code(400).send(replyError(err, "Invalid clock time"));
    }
  });

  app.patch<{ Params: { scheduleId: string } }>(
    "/api/clock-schedules/:scheduleId",
    async (request, reply) => {
      const user = await options.identity.userFrom(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const existing = getClockSchedule(db, request.params.scheduleId);
      if (existing === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const parsed = patchBodySchema.safeParse(request.body);
      if (parsed.success !== true) {
        return reply.code(400).send({ error: "Invalid clock time" });
      }
      const hasTitle = parsed.data.title !== undefined;
      const hasCron = parsed.data.cron !== undefined;
      const hasEnabled = parsed.data.enabled !== undefined;
      if (hasTitle !== true && hasCron !== true && hasEnabled !== true) {
        return reply.code(400).send({ error: "Invalid clock time" });
      }
      try {
        const schedule = patchClockSchedule(db, existing.id, parsed.data);
        return schedule;
      } catch (err) {
        return reply.code(400).send(replyError(err, "Invalid clock time"));
      }
    },
  );

  app.delete<{ Params: { scheduleId: string } }>(
    "/api/clock-schedules/:scheduleId",
    async (request, reply) => {
      const user = await options.identity.userFrom(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const existing = getClockSchedule(db, request.params.scheduleId);
      if (existing === null) {
        return reply.code(404).send({ error: "not found" });
      }
      try {
        deleteClockSchedule(db, existing.id);
        return reply.code(204).send();
      } catch (err) {
        return reply.code(400).send(replyError(err, "Invalid clock time"));
      }
    },
  );
}
