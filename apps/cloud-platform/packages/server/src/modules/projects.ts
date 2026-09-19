import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createProject,
  listPublicProjects,
  refreshProjectRegistry,
  updateProject,
} from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { requireExistingDirectory } from "../folder-path.js";
import { pickFolderPath } from "../folder-picker.js";
import { requestGithubPoll } from "../github-poll.js";
import {
  findProjectGitLink,
  getProjectGitLink,
  gitProviderSchema,
  insertProjectGitLink,
} from "../git-repo-store.js";
import { gitCloneToken } from "../git-providers.js";
import { detectGitCheckout } from "../github-remote.js";
import type { GithubAuth } from "./github-auth.js";
import type { Identity } from "./identity.js";
import { attachExistingGitRepo } from "./git-projects.js";
import type { ProjectPathsOptions } from "./project-paths.js";

const projectIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const gitBindSchema = z.object({
  provider: gitProviderSchema,
  owner: z.string().trim().min(1),
  repo: z.string().trim().min(1),
  branch: z.string().trim().min(1).optional(),
});

const createGitSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim(),
    workflowTemplateId: z.string().trim().min(1),
    git: gitBindSchema,
  })
  .strict();

const createFolderSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim(),
    workflowTemplateId: z.string().trim().min(1),
    repoPath: z.string().trim().min(1),
  })
  .strict();

const createProjectSchema = z.union([createGitSchema, createFolderSchema]);

const updateProjectSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim(),
  workflowTemplateId: z.string().trim().min(1),
});

const projectParamsSchema = z.object({
  projectId: z.string().trim().regex(projectIdPattern),
});

export type ProjectsModuleOptions = ProjectPathsOptions & {
  identity: Identity;
  github: GithubAuth;
  databasePath: string;
};

function publicGit(dataDir: string, projectId: string) {
  const link = getProjectGitLink(dataDir, projectId);
  if (link === null) {
    return null;
  }
  return {
    provider: link.provider,
    owner: link.owner,
    repo: link.repo,
    branch: link.branch,
  };
}

export async function registerProjectsModule(
  app: FastifyInstance,
  options: ProjectsModuleOptions,
): Promise<void> {
  const identity = options.identity;
  const dataDir = options.dataDir;
  refreshProjectRegistry();

  app.get("/api/projects", async (request, reply) => {
    const user = await identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    refreshProjectRegistry();
    const listed = listPublicProjects(user.id);
    const projects: unknown[] = [];
    for (const project of listed) {
      projects.push({
        id: project.id,
        name: project.name,
        description: project.description,
        workflowTemplateId: project.workflowTemplateId,
        repoPath: project.repoPath,
        git: publicGit(dataDir, project.id),
      });
    }
    return { projects };
  });

  app.post("/api/folder/pick", async (request, reply) => {
    const user = await identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    try {
      const picked = pickFolderPath(process.platform);
      if (picked === null) {
        return { path: "" };
      }
      return { path: requireExistingDirectory(picked) };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Folder picker failed";
      return reply.code(500).send({ error: message });
    }
  });

  app.post("/api/projects", async (request, reply) => {
    const user = await identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = createProjectSchema.safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "folder path or git repository is required" });
    }
    const input = parsed.data;
    if ("git" in input) {
      const branch = input.git.branch === undefined || input.git.branch.length === 0
        ? "main"
        : input.git.branch;
      const taken = findProjectGitLink(dataDir, input.git.provider, input.git.owner, input.git.repo);
      if (taken !== null) {
        return reply.code(409).send({ error: "that repository is already linked to a project" });
      }
      const created = createProject(
        {
          name: input.name,
          description: input.description,
          workflowTemplateId: input.workflowTemplateId,
          repoPath: "",
        },
        user.id,
      );
      if (created === "duplicate") {
        return reply.code(409).send({ error: "Project id already exists" });
      }
      if (created === null) {
        return reply.code(400).send({ error: "Invalid project" });
      }
      const attached = await attachExistingGitRepo({
        paths: options,
        dataDir,
        github: options.github,
        cloneToken: gitCloneToken(
          input.git.provider,
          options.github,
          user.id,
          options.databasePath,
        ),
        projectId: created.id,
        ownerId: user.id,
        provider: input.git.provider,
        owner: input.git.owner,
        repo: input.git.repo,
        branch,
      });
      if (attached.error !== null) {
        return reply.code(409).send({ error: attached.error });
      }
      let repoPath = created.repoPath;
      if (attached.repoPath.length > 0) {
        const updated = updateProject(
          created.id,
          {
            name: created.name,
            description: created.description,
            workflowTemplateId: created.workflowTemplateId,
            repoPath: attached.repoPath,
          },
          user.id,
        );
        if (updated !== null) {
          repoPath = updated.repoPath;
        }
      }
      requestGithubPoll();
      return reply.code(201).send({
        id: created.id,
        name: created.name,
        description: created.description,
        workflowTemplateId: created.workflowTemplateId,
        repoPath,
        git: publicGit(dataDir, created.id),
      });
    }
    let folderPath = input.repoPath;
    try {
      folderPath = requireExistingDirectory(input.repoPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid folder path";
      return reply.code(400).send({ error: message });
    }
    const detected = await detectGitCheckout(folderPath);
    const checkout = detected[0];
    if (checkout !== undefined) {
      const taken = findProjectGitLink(dataDir, checkout.provider, checkout.owner, checkout.repo);
      if (taken !== null) {
        return reply.code(409).send({ error: "that repository is already linked to a project" });
      }
    }
    const created = createProject(
      {
        name: input.name,
        description: input.description,
        workflowTemplateId: input.workflowTemplateId,
        repoPath: folderPath,
      },
      user.id,
    );
    if (created === "duplicate") {
      return reply.code(409).send({ error: "Project id already exists" });
    }
    if (created === null) {
      return reply.code(400).send({ error: "Invalid project" });
    }
    if (checkout !== undefined) {
      const saved = insertProjectGitLink(dataDir, {
        projectId: created.id,
        ownerId: user.id,
        provider: checkout.provider,
        owner: checkout.owner,
        repo: checkout.repo,
        branch: checkout.branch,
        linkedAt: Date.now(),
      });
      if (saved !== true) {
        return reply.code(409).send({ error: "that repository is already linked to a project" });
      }
      requestGithubPoll();
    }
    return reply.code(201).send({
      id: created.id,
      name: created.name,
      description: created.description,
      workflowTemplateId: created.workflowTemplateId,
      repoPath: created.repoPath,
      git: publicGit(dataDir, created.id),
    });
  });

  app.patch("/api/projects/:projectId", async (request, reply) => {
    const user = await identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const paramsParsed = projectParamsSchema.safeParse(request.params);
    if (paramsParsed.success !== true) {
      return reply.code(400).send({ error: "Invalid project id" });
    }
    const { projectId } = paramsParsed.data;
    const bodyParsed = updateProjectSchema.safeParse(request.body);
    if (bodyParsed.success !== true) {
      return reply.code(400).send({ error: "Invalid project" });
    }
    const input = bodyParsed.data;
    const updated = updateProject(
      projectId,
      {
        name: input.name,
        description: input.description,
        workflowTemplateId: input.workflowTemplateId,
        repoPath: "",
      },
      user.id,
    );
    if (updated === null) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return reply.send({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      workflowTemplateId: updated.workflowTemplateId,
      repoPath: updated.repoPath,
      git: publicGit(dataDir, updated.id),
    });
  });
}
