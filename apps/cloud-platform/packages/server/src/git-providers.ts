import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadConnectionSecret, connectionsDatabase } from "./connection-store.js";
import { loadGithubToken } from "./github-store.js";
import { GIT_PROVIDER_VALUES, gitProviderSchema, type GitProvider } from "./git-repo-store.js";
import type { GithubAuth } from "./modules/github-auth.js";
import type { Identity } from "./modules/identity.js";

export type GitProviderStatus = {
  id: GitProvider;
  label: string;
  connected: boolean;
};

export type GitRemoteRepo = {
  provider: GitProvider;
  fullName: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  private: boolean;
};

export type AzureDevopsSecret = {
  organization: string;
  token: string;
};

export type BitbucketSecret = {
  username: string;
  token: string;
};

type GithubAuthOptions = {
  identity: Identity;
  github: GithubAuth;
  databasePath: string;
};

const githubRepoWireSchema = z.object({
  full_name: z.string().min(1),
  private: z.boolean(),
  default_branch: z.string().min(1),
  owner: z.object({
    login: z.string().min(1),
  }),
  name: z.string().min(1),
});

const gitlabProjectWireSchema = z.object({
  path_with_namespace: z.string().min(1),
  default_branch: z.string().nullable(),
  visibility: z.string(),
});

const azureOrgNameSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/);

const azureTokenSchema = z.string().min(8);

const azureRepoWireSchema = z.object({
  name: z.string().min(1),
  defaultBranch: z.string().nullable().optional(),
  isDisabled: z.boolean().optional(),
  project: z.object({
    name: z.string().min(1),
  }),
});

const azureRepoListSchema = z.object({
  value: z.array(z.unknown()),
});

const bitbucketTokenSchema = z.string().min(8);

const bitbucketWorkspaceWireSchema = z.object({
  workspace: z.object({
    slug: z.string().min(1),
  }),
});

const bitbucketWorkspaceListSchema = z.object({
  values: z.array(z.unknown()),
});

const bitbucketRepoWireSchema = z.object({
  full_name: z.string().min(1),
  slug: z.string().min(1),
  is_private: z.boolean(),
  mainbranch: z
    .object({
      name: z.string().min(1),
    })
    .nullable()
    .optional(),
});

const bitbucketRepoListSchema = z.object({
  values: z.array(z.unknown()),
});

export function githubUserToken(
  github: GithubAuth,
  userId: string,
  databasePath: string,
): string {
  const oauth = github.getAccessToken(userId);
  if (oauth !== null && oauth.length > 0) {
    return oauth;
  }
  const pat = loadGithubToken(connectionsDatabase(databasePath));
  if (pat.length > 0) {
    return pat;
  }
  return "";
}

function azureOrganizationFrom(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return [];
  }
  if (trimmed.includes("://") === true) {
    const urlParse = z.string().url().safeParse(trimmed);
    if (urlParse.success !== true) {
      return [];
    }
    const parsedUrl = new URL(urlParse.data);
    if (parsedUrl.hostname !== "dev.azure.com") {
      return [];
    }
    const segments = parsedUrl.pathname.split("/");
    const named: string[] = [];
    for (const segment of segments) {
      if (segment.length > 0) {
        named.push(segment);
      }
    }
    const first = named[0];
    if (first === undefined) {
      return [];
    }
    const org = azureOrgNameSchema.safeParse(first);
    if (org.success !== true) {
      return [];
    }
    return [org.data];
  }
  const org = azureOrgNameSchema.safeParse(trimmed);
  if (org.success !== true) {
    return [];
  }
  return [org.data];
}

export function parseAzureDevopsSecret(secret: string): AzureDevopsSecret[] {
  const trimmed = secret.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return [];
  }
  const orgRaw = parts[0];
  if (orgRaw === undefined) {
    return [];
  }
  const tokenParts: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === undefined) {
      continue;
    }
    tokenParts.push(part);
  }
  const tokenJoined = tokenParts.join(" ");
  const token = azureTokenSchema.safeParse(tokenJoined);
  if (token.success !== true) {
    return [];
  }
  const organizations = azureOrganizationFrom(orgRaw);
  const organization = organizations[0];
  if (organization === undefined) {
    return [];
  }
  return [{ organization, token: token.data }];
}

export function parseBitbucketSecret(secret: string): BitbucketSecret[] {
  const trimmed = secret.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  if (first === undefined) {
    return [];
  }
  if (parts.length === 1) {
    const token = bitbucketTokenSchema.safeParse(first);
    if (token.success !== true) {
      return [];
    }
    return [{ username: "x-token-auth", token: token.data }];
  }
  const tokenParts: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === undefined) {
      continue;
    }
    tokenParts.push(part);
  }
  const tokenJoined = tokenParts.join(" ");
  const user = z.string().min(1).safeParse(first);
  const token = bitbucketTokenSchema.safeParse(tokenJoined);
  if (user.success !== true || token.success !== true) {
    return [];
  }
  return [{ username: user.data, token: token.data }];
}

export function azureRepoOwnerParts(owner: string): { organization: string; project: string }[] {
  const trimmed = owner.trim();
  const slash = trimmed.indexOf("/");
  if (slash < 1) {
    return [];
  }
  const organizationRaw = trimmed.slice(0, slash);
  const projectRaw = trimmed.slice(slash + 1);
  const organization = azureOrgNameSchema.safeParse(organizationRaw);
  const project = z.string().min(1).safeParse(projectRaw);
  if (organization.success !== true || project.success !== true) {
    return [];
  }
  return [{ organization: organization.data, project: project.data }];
}

function azureDefaultBranch(ref: string): string {
  const trimmed = ref.trim();
  const prefix = "refs/heads/";
  if (trimmed.startsWith(prefix) === true) {
    const name = trimmed.slice(prefix.length);
    if (name.length > 0) {
      return name;
    }
  }
  if (trimmed.length > 0) {
    return trimmed;
  }
  return "main";
}

export function gitProviderLabel(provider: GitProvider): string {
  switch (provider) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "azuredevops":
      return "Azure DevOps";
    case "bitbucket":
      return "Bitbucket";
  }
}

export function publicGitCloneUrl(provider: GitProvider, owner: string, repo: string): string {
  switch (provider) {
    case "github":
      return `https://github.com/${owner}/${repo}.git`;
    case "gitlab":
      return `https://gitlab.com/${owner}/${repo}.git`;
    case "azuredevops": {
      const parts = azureRepoOwnerParts(owner);
      const hit = parts[0];
      if (hit === undefined) {
        return "";
      }
      const organization = encodeURIComponent(hit.organization);
      const project = encodeURIComponent(hit.project);
      const name = encodeURIComponent(repo);
      return `https://dev.azure.com/${organization}/${project}/_git/${name}`;
    }
    case "bitbucket":
      return `https://bitbucket.org/${owner}/${repo}.git`;
  }
}

export function authedGitCloneUrl(
  provider: GitProvider,
  token: string,
  owner: string,
  repo: string,
): string {
  switch (provider) {
    case "github":
      return `https://${token}@github.com/${owner}/${repo}.git`;
    case "gitlab":
      return `https://oauth2:${encodeURIComponent(token)}@gitlab.com/${owner}/${repo}.git`;
    case "azuredevops": {
      const parts = azureRepoOwnerParts(owner);
      const hit = parts[0];
      if (hit === undefined) {
        return "";
      }
      const organization = encodeURIComponent(hit.organization);
      const project = encodeURIComponent(hit.project);
      const name = encodeURIComponent(repo);
      const password = encodeURIComponent(token);
      return `https://${organization}:${password}@dev.azure.com/${organization}/${project}/_git/${name}`;
    }
    case "bitbucket":
      return `https://x-token-auth:${encodeURIComponent(token)}@bitbucket.org/${owner}/${repo}.git`;
  }
}

export function gitCloneToken(
  provider: GitProvider,
  github: GithubAuth,
  userId: string,
  databasePath: string,
): string {
  const settingsDb = connectionsDatabase(databasePath);
  switch (provider) {
    case "github":
      return githubUserToken(github, userId, databasePath);
    case "gitlab":
      return loadConnectionSecret(settingsDb, "gitlab");
    case "azuredevops": {
      const hits = parseAzureDevopsSecret(loadConnectionSecret(settingsDb, "azuredevops"));
      const hit = hits[0];
      if (hit === undefined) {
        return "";
      }
      return hit.token;
    }
    case "bitbucket": {
      const hits = parseBitbucketSecret(loadConnectionSecret(settingsDb, "bitbucket"));
      const hit = hits[0];
      if (hit === undefined) {
        return "";
      }
      return hit.token;
    }
  }
}

function splitFullName(fullName: string): { owner: string; repo: string } {
  const parts = fullName.split("/");
  if (parts.length < 2) {
    return { owner: "", repo: "" };
  }
  const repo = parts[parts.length - 1];
  if (repo === undefined) {
    return { owner: "", repo: "" };
  }
  const ownerParts: string[] = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (part === undefined) {
      continue;
    }
    ownerParts.push(part);
  }
  return { owner: ownerParts.join("/"), repo };
}

function azureBasicAuth(token: string): string {
  const encoded = Buffer.from(`:${token}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

function bitbucketAuthHeader(secret: BitbucketSecret): string {
  if (secret.username === "x-token-auth") {
    return `Bearer ${secret.token}`;
  }
  const encoded = Buffer.from(`${secret.username}:${secret.token}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

export async function listGithubRemoteRepos(token: string): Promise<GitRemoteRepo[]> {
  const listed: GitRemoteRepo[] = [];
  const response = await fetch(
    "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "Lotaru",
      },
    },
  );
  if (response.ok !== true) {
    throw new Error("github_repos_fetch_failed");
  }
  const body = z.array(z.unknown()).safeParse(await response.json());
  if (body.success !== true) {
    throw new Error("github_repos_fetch_failed");
  }
  for (const row of body.data) {
    const parsed = githubRepoWireSchema.safeParse(row);
    if (parsed.success !== true) {
      continue;
    }
    listed.push({
      provider: "github",
      fullName: parsed.data.full_name,
      owner: parsed.data.owner.login,
      repo: parsed.data.name,
      defaultBranch: parsed.data.default_branch,
      private: parsed.data.private,
    });
  }
  return listed;
}

export async function listGitlabRemoteRepos(token: string): Promise<GitRemoteRepo[]> {
  const listed: GitRemoteRepo[] = [];
  const response = await fetch(
    "https://gitlab.com/api/v4/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at",
    {
      headers: {
        "PRIVATE-TOKEN": token,
        accept: "application/json",
        "user-agent": "Lotaru",
      },
    },
  );
  if (response.ok !== true) {
    throw new Error("gitlab_repos_fetch_failed");
  }
  const body = z.array(z.unknown()).safeParse(await response.json());
  if (body.success !== true) {
    throw new Error("gitlab_repos_fetch_failed");
  }
  for (const row of body.data) {
    const parsed = gitlabProjectWireSchema.safeParse(row);
    if (parsed.success !== true) {
      continue;
    }
    const split = splitFullName(parsed.data.path_with_namespace);
    if (split.owner.length === 0 || split.repo.length === 0) {
      continue;
    }
    let branch = "main";
    if (parsed.data.default_branch !== null && parsed.data.default_branch.length > 0) {
      branch = parsed.data.default_branch;
    }
    listed.push({
      provider: "gitlab",
      fullName: parsed.data.path_with_namespace,
      owner: split.owner,
      repo: split.repo,
      defaultBranch: branch,
      private: parsed.data.visibility !== "public",
    });
  }
  return listed;
}

export async function listAzureDevopsRemoteRepos(secret: string): Promise<GitRemoteRepo[]> {
  const hits = parseAzureDevopsSecret(secret);
  const cred = hits[0];
  if (cred === undefined) {
    throw new Error("azuredevops_repos_fetch_failed");
  }
  const listed: GitRemoteRepo[] = [];
  const org = encodeURIComponent(cred.organization);
  const response = await fetch(
    `https://dev.azure.com/${org}/_apis/git/repositories?api-version=7.1`,
    {
      headers: {
        authorization: azureBasicAuth(cred.token),
        accept: "application/json",
        "user-agent": "Lotaru",
      },
    },
  );
  if (response.ok !== true) {
    throw new Error("azuredevops_repos_fetch_failed");
  }
  const body = azureRepoListSchema.safeParse(await response.json());
  if (body.success !== true) {
    throw new Error("azuredevops_repos_fetch_failed");
  }
  for (const row of body.data.value) {
    const parsed = azureRepoWireSchema.safeParse(row);
    if (parsed.success !== true) {
      continue;
    }
    if (parsed.data.isDisabled === true) {
      continue;
    }
    let branch = "main";
    if (parsed.data.defaultBranch !== undefined && parsed.data.defaultBranch !== null) {
      branch = azureDefaultBranch(parsed.data.defaultBranch);
    }
    const owner = `${cred.organization}/${parsed.data.project.name}`;
    listed.push({
      provider: "azuredevops",
      fullName: `${owner}/${parsed.data.name}`,
      owner,
      repo: parsed.data.name,
      defaultBranch: branch,
      private: true,
    });
  }
  return listed;
}

async function listBitbucketWorkspaceRepos(
  headers: { authorization: string; accept: string; "user-agent": string },
  workspace: string,
): Promise<GitRemoteRepo[]> {
  const listed: GitRemoteRepo[] = [];
  const slug = encodeURIComponent(workspace);
  const response = await fetch(
    `https://api.bitbucket.org/2.0/repositories/${slug}?pagelen=100&role=member`,
    { headers },
  );
  if (response.ok !== true) {
    throw new Error("bitbucket_repos_fetch_failed");
  }
  const body = bitbucketRepoListSchema.safeParse(await response.json());
  if (body.success !== true) {
    throw new Error("bitbucket_repos_fetch_failed");
  }
  for (const row of body.data.values) {
    const parsed = bitbucketRepoWireSchema.safeParse(row);
    if (parsed.success !== true) {
      continue;
    }
    const split = splitFullName(parsed.data.full_name);
    if (split.owner.length === 0 || split.repo.length === 0) {
      continue;
    }
    let branch = "main";
    if (parsed.data.mainbranch !== undefined && parsed.data.mainbranch !== null) {
      branch = parsed.data.mainbranch.name;
    }
    listed.push({
      provider: "bitbucket",
      fullName: parsed.data.full_name,
      owner: split.owner,
      repo: parsed.data.slug,
      defaultBranch: branch,
      private: parsed.data.is_private,
    });
  }
  return listed;
}

export async function listBitbucketRemoteRepos(secret: string): Promise<GitRemoteRepo[]> {
  const hits = parseBitbucketSecret(secret);
  const cred = hits[0];
  if (cred === undefined) {
    throw new Error("bitbucket_repos_fetch_failed");
  }
  const headers = {
    authorization: bitbucketAuthHeader(cred),
    accept: "application/json",
    "user-agent": "Lotaru",
  };
  const response = await fetch("https://api.bitbucket.org/2.0/user/workspaces?pagelen=100", {
    headers,
  });
  if (response.ok !== true) {
    throw new Error("bitbucket_repos_fetch_failed");
  }
  const body = bitbucketWorkspaceListSchema.safeParse(await response.json());
  if (body.success !== true) {
    throw new Error("bitbucket_repos_fetch_failed");
  }
  const listed: GitRemoteRepo[] = [];
  for (const row of body.data.values) {
    const parsed = bitbucketWorkspaceWireSchema.safeParse(row);
    if (parsed.success !== true) {
      continue;
    }
    const repos = await listBitbucketWorkspaceRepos(headers, parsed.data.workspace.slug);
    for (const repo of repos) {
      listed.push(repo);
    }
  }
  return listed;
}

function providerConnected(
  provider: GitProvider,
  githubOauth: boolean,
  githubPat: string,
  settingsDb: ReturnType<typeof connectionsDatabase>,
): boolean {
  switch (provider) {
    case "github":
      return githubOauth === true || githubPat.length > 0;
    case "gitlab":
      return loadConnectionSecret(settingsDb, "gitlab").length > 0;
    case "azuredevops":
      return parseAzureDevopsSecret(loadConnectionSecret(settingsDb, "azuredevops")).length > 0;
    case "bitbucket":
      return parseBitbucketSecret(loadConnectionSecret(settingsDb, "bitbucket")).length > 0;
  }
}

export async function registerGitProvidersModule(
  app: FastifyInstance,
  options: GithubAuthOptions,
): Promise<void> {
  app.get("/api/v1/git/providers", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const settingsDb = connectionsDatabase(options.databasePath);
    const githubPat = loadGithubToken(settingsDb);
    const githubOauth = options.github.getAccount(user.id);
    const providers: GitProviderStatus[] = [];
    for (const id of GIT_PROVIDER_VALUES) {
      providers.push({
        id,
        label: gitProviderLabel(id),
        connected: providerConnected(id, githubOauth !== null, githubPat, settingsDb),
      });
    }
    return { providers };
  });

  app.get("/api/v1/git/repos", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const query = z.object({ provider: gitProviderSchema }).safeParse(request.query);
    if (query.success !== true) {
      return reply.code(400).send({ error: "provider required" });
    }
    const settingsDb = connectionsDatabase(options.databasePath);
    const provider = query.data.provider;
    try {
      switch (provider) {
        case "github": {
          const token = githubUserToken(options.github, user.id, options.databasePath);
          if (token.length === 0) {
            return reply.code(409).send({ error: "github not connected" });
          }
          const repos = await listGithubRemoteRepos(token);
          return { repos };
        }
        case "gitlab": {
          const gitlabToken = loadConnectionSecret(settingsDb, "gitlab");
          if (gitlabToken.length === 0) {
            return reply.code(409).send({ error: "gitlab not connected" });
          }
          const repos = await listGitlabRemoteRepos(gitlabToken);
          return { repos };
        }
        case "azuredevops": {
          const azureSecret = loadConnectionSecret(settingsDb, "azuredevops");
          if (parseAzureDevopsSecret(azureSecret).length === 0) {
            return reply.code(409).send({ error: "azuredevops not connected" });
          }
          const repos = await listAzureDevopsRemoteRepos(azureSecret);
          return { repos };
        }
        case "bitbucket": {
          const bitbucketSecret = loadConnectionSecret(settingsDb, "bitbucket");
          if (parseBitbucketSecret(bitbucketSecret).length === 0) {
            return reply.code(409).send({ error: "bitbucket not connected" });
          }
          const repos = await listBitbucketRemoteRepos(bitbucketSecret);
          return { repos };
        }
      }
    } catch {
      return reply.code(502).send({ error: `${provider}_repos_fetch_failed` });
    }
  });
}
