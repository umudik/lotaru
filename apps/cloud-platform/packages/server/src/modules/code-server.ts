import Docker from "dockerode";
import type { FastifyInstance, FastifyRequest } from "fastify";
import httpProxy from "http-proxy";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import type { Socket } from "node:net";
import type { IncomingMessage } from "node:http";
import { userCanAccessProject } from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import type { Identity, IdentityUser } from "./identity.js";
import { hostProjectDir, type ProjectPathsOptions } from "./project-paths.js";

// code-server's own web UI is only officially supported at the root path or on a
// distinct host — path-prefix reverse proxying breaks its asset/service-worker/ws
// paths. So each project's IDE is served on its own subdomain
// (`<projectId>.<codeServerDomain>`) instead of a path under the main app, routed by
// Host header from this same process/port.
export type CodeServerOptions = ProjectPathsOptions & {
  identity: Identity;
  image: string;
  // e.g. "code.fookiecloud.com" -> IDE served at "<projectId>.code.fookiecloud.com".
  // Feature is disabled entirely when this is null.
  domain: string | null;
  publicUrl: string;
  memoryLimitMb: number;
  cpuLimit: number;
};

const CONTAINER_PORT = "8080/tcp";
const TICKET_TTL_MS = 60_000;
const COOKIE_TTL_SECONDS = 12 * 60 * 60;
const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function containerName(projectId: string): string {
  return `fookie-code-${projectId}`;
}

function projectIdFromHost(host: string | undefined, domain: string): string | null {
  if (host === undefined) {
    return null;
  }
  const bareHost = host.split(":")[0]?.toLowerCase() ?? "";
  const suffix = `.${domain}`;
  if (!bareHost.endsWith(suffix)) {
    return null;
  }
  const candidate = bareHost.slice(0, bareHost.length - suffix.length);
  return PROJECT_ID_PATTERN.test(candidate) ? candidate : null;
}

function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (header === undefined) {
    return out;
  }
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      out.set(part.slice(0, idx).trim(), decodeURIComponent(part.slice(idx + 1).trim()));
    }
  }
  return out;
}

export async function registerCodeServerModule(
  app: FastifyInstance,
  options: CodeServerOptions,
): Promise<void> {
  const docker = new Docker();
  const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true, xfwd: true });
  proxy.on("error", (err) => {
    app.log.error({ err }, "code-server proxy error");
  });

  const domain = options.domain;
  const secure = options.publicUrl.startsWith("https://");

  // Single-use ticket minted by /ide/start, redeemed once on the IDE subdomain to set
  // a session cookie — the IDE origin has no way to see the SPA's bearer token, so
  // this is the handoff. Sessions map is the "logged in on this subdomain" record.
  const tickets = new Map<string, { projectId: string; expiresAt: number }>();
  const sessions = new Map<string, { projectId: string; expiresAt: number }>();
  function sweep(): void {
    const now = Date.now();
    for (const [key, entry] of tickets) {
      if (entry.expiresAt < now) tickets.delete(key);
    }
    for (const [key, entry] of sessions) {
      if (entry.expiresAt < now) sessions.delete(key);
    }
  }

  // Anyone can sign up, so two IDE containers must be treated as mutually hostile.
  // Each project gets its own bridge network and ONLY this process joins it, so an
  // IDE can reach the internet (npm install) and nothing else on the host: not the
  // platform database, not Dokploy, and above all not another user's IDE — those
  // run code-server with --auth none and would otherwise be one curl away.
  const joinedNetworks = new Set<string>();

  function ideNetworkName(projectId: string): string {
    return `fookie-ide-${projectId}`;
  }

  async function ensureIdeNetwork(projectId: string): Promise<string> {
    const name = ideNetworkName(projectId);
    if (joinedNetworks.has(name)) {
      return name;
    }
    try {
      await docker.getNetwork(name).inspect();
    } catch {
      await docker.createNetwork({ Name: name, Driver: "bridge" });
    }
    try {
      await docker.getNetwork(name).connect({ Container: hostname() });
    } catch {
      // already attached — this process keeps its membership across IDE restarts
    }
    joinedNetworks.add(name);
    return name;
  }

  async function removeIdeNetwork(projectId: string): Promise<void> {
    const name = ideNetworkName(projectId);
    joinedNetworks.delete(name);
    try {
      await docker.getNetwork(name).disconnect({ Container: hostname(), Force: true });
    } catch {
      // not attached
    }
    try {
      await docker.getNetwork(name).remove();
    } catch {
      // still in use or already gone
    }
  }

  async function resolveTarget(projectId: string): Promise<string | null> {
    const container = docker.getContainer(containerName(projectId));
    let info: Docker.ContainerInspectInfo;
    try {
      info = await container.inspect();
    } catch {
      return null;
    }
    if (!info.State.Running) {
      return null;
    }
    // Re-joining is what makes the proxy survive a redeploy: a fresh app container
    // starts with no membership in the per-project networks created before it.
    await ensureIdeNetwork(projectId);
    return `http://${containerName(projectId)}:8080`;
  }

  async function ensureContainer(projectId: string): Promise<void> {
    const name = containerName(projectId);
    const existing = docker.getContainer(name);
    const ideNetwork = await ensureIdeNetwork(projectId);
    try {
      const info = await existing.inspect();
      if (!info.State.Running) {
        await existing.start();
      }
      return;
    } catch {
      // not found — fall through to create
    }
    try {
      await docker.getImage(options.image).inspect();
    } catch {
      const stream = await docker.pull(options.image, {});
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (err: Error | null) => {
          if (err === null) resolve();
          else reject(err);
        });
      });
    }
    const hostConfig: Docker.HostConfig = {
      Binds: [`${hostProjectDir(options, projectId)}:/home/coder/project:rw`],
      RestartPolicy: { Name: "unless-stopped" },
      NetworkMode: ideNetwork,
      // Without these one tenant can starve every other one: an IDE terminal is a
      // shell, and a runaway build or fork bomb in it would otherwise take the whole
      // host down. PidsLimit is what actually stops fork bombs; Memory alone does not.
      Memory: options.memoryLimitMb * 1024 * 1024,
      NanoCpus: Math.round(options.cpuLimit * 1_000_000_000),
      PidsLimit: 512,
    };
    const container = await docker.createContainer({
      name,
      Image: options.image,
      // Everything else that writes into the project folder — git clone/pull from this
      // process, the script sandbox — runs as root, so their files land root-owned. The
      // image defaults to uid 1000 (coder), which then cannot save over them.
      User: "0:0",
      Env: ["HOME=/root"],
      Cmd: ["--auth", "none", "--bind-addr", "0.0.0.0:8080", "/home/coder/project"],
      ExposedPorts: { [CONTAINER_PORT]: {} },
      HostConfig: hostConfig,
    });
    await container.start();
  }

  async function requireProjectAccess(
    request: FastifyRequest,
    projectId: string,
  ): Promise<IdentityUser | null> {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return null;
    }
    if (!userCanAccessProject(projectId, user.id)) {
      return null;
    }
    return user;
  }

  app.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/ide/start",
    async (request, reply) => {
      if (domain === null) {
        return reply.code(503).send({ error: "code-server is not configured" });
      }
      const user = await requireProjectAccess(request, request.params.projectId);
      if (user === null) {
        return reply.code(404).send({ error: "not found" });
      }
      try {
        await ensureContainer(request.params.projectId);
      } catch (err) {
        return reply.code(502).send({
          error: `failed to start code-server: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      let ready = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const target = await resolveTarget(request.params.projectId);
        if (target !== null) {
          try {
            const res = await fetch(target);
            if (res.status < 500) {
              ready = true;
              break;
            }
          } catch {
            // still starting
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!ready) {
        return reply.code(504).send({ error: "code-server did not become ready in time" });
      }
      sweep();
      const ticket = randomBytes(24).toString("base64url");
      tickets.set(ticket, { projectId: request.params.projectId, expiresAt: Date.now() + TICKET_TTL_MS });
      const scheme = secure ? "https" : "http";
      return {
        url: `${scheme}://${request.params.projectId}.${domain}/?fc_ide=${ticket}`,
      };
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/ide/stop",
    async (request, reply) => {
      const user = await requireProjectAccess(request, request.params.projectId);
      if (user === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const container = docker.getContainer(containerName(request.params.projectId));
      try {
        await container.stop();
      } catch {
        // already stopped/missing — fine
      }
      // Drop the container as well: the project files live on the bind mount, so
      // nothing is lost, and it lets the per-project network go away instead of
      // pinning a subnet from Docker's finite address pool for every project ever
      // opened. A later start recreates both in a couple of seconds.
      try {
        await container.remove({ force: true });
      } catch {
        // already gone
      }
      await removeIdeNetwork(request.params.projectId);
      return { ok: true };
    },
  );

  if (domain === null) {
    return;
  }

  // Host-routed IDE traffic bypasses normal path-based routing entirely — this hook
  // runs for every request on this same port/process and short-circuits when the
  // Host header names a project's IDE subdomain.
  app.addHook("onRequest", async (request, reply) => {
    const projectId = projectIdFromHost(request.headers.host, domain);
    if (projectId === null) {
      return;
    }
    sweep();
    const cookies = parseCookies(request.headers.cookie);
    const query = request.query as { fc_ide?: unknown };
    let sessionId = cookies.get("fc_ide");

    if (typeof query.fc_ide === "string") {
      const ticket = tickets.get(query.fc_ide);
      if (ticket === undefined || ticket.projectId !== projectId) {
        return reply.code(403).send("invalid or expired IDE link");
      }
      tickets.delete(query.fc_ide);
      sessionId = randomBytes(24).toString("base64url");
      sessions.set(sessionId, { projectId, expiresAt: Date.now() + COOKIE_TTL_SECONDS * 1000 });
      const cookieParts = [
        `fc_ide=${sessionId}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${COOKIE_TTL_SECONDS}`,
      ];
      if (secure) cookieParts.push("Secure");
      reply.header("Set-Cookie", cookieParts.join("; "));
      // redirect to the clean URL so the ticket never lingers in browser history
      return reply.redirect(new URL(request.url, `http://${request.headers.host}`).pathname);
    }

    const session = sessionId !== undefined ? sessions.get(sessionId) : undefined;
    if (session === undefined || session.projectId !== projectId) {
      return reply.code(401).send("not connected — open the IDE from the project page");
    }

    const target = await resolveTarget(projectId);
    if (target === null) {
      return reply.code(409).send("IDE is not running — start it from the project page");
    }
    reply.hijack();
    proxy.web(request.raw, reply.raw, { target });
  });

  app.server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const projectId = projectIdFromHost(req.headers.host, domain);
    if (projectId === null) {
      return;
    }
    void (async () => {
      sweep();
      const cookies = parseCookies(req.headers.cookie);
      const sessionId = cookies.get("fc_ide");
      const session = sessionId !== undefined ? sessions.get(sessionId) : undefined;
      if (session === undefined || session.projectId !== projectId) {
        socket.destroy();
        return;
      }
      const target = await resolveTarget(projectId);
      if (target === null) {
        socket.destroy();
        return;
      }
      proxy.ws(req, socket, head, { target });
    })();
  });
}
