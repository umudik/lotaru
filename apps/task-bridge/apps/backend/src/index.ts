import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { projectRoutes } from "./routes/projects.js";
import { taskRoutes } from "./routes/tasks.js";
import { docsRoutes } from "./routes/docs.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { libraryRoutes } from "./routes/library.js";
import { refreshProjectRegistry, initProjectRegistry } from "./services/project-registry.js";
import { migrateApiKeysTables } from "./db/api-keys-db.js";
import {
  configureFookieAccessTokenVerifier,
  type FookieAuthUser,
} from "./auth/fookie.js";

export type TaskBridgeModuleOptions = {
  verifyAccessToken?: (raw: string) => Promise<FookieAuthUser>;
  registerProjectRoutes?: boolean;
};

export async function registerTaskBridgeModule(
  app: FastifyInstance,
  options: TaskBridgeModuleOptions = {},
): Promise<void> {
  configureFookieAccessTokenVerifier(options.verifyAccessToken ?? null);
  await app.register(cors, {
    origin: true,
  });

  initProjectRegistry();
  refreshProjectRegistry();
  migrateApiKeysTables();

  await app.register(
    async (apiApp) => {
      docsRoutes(apiApp);
      apiKeyRoutes(apiApp);
      if (options.registerProjectRoutes !== false) {
        projectRoutes(apiApp);
      }
      taskRoutes(apiApp);
      await libraryRoutes(apiApp);
    },
    { prefix: "/api" },
  );
}
