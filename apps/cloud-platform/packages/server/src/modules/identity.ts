import type { FastifyInstance, FastifyRequest } from "fastify";

export type IdentityUser = {
  id: string;
  email: string;
  name: string;
  clientId: string;
};

export type Identity = {
  verifyAccessToken(token: string): Promise<IdentityUser>;
  userFrom(request: FastifyRequest): Promise<IdentityUser | null>;
  register(app: FastifyInstance): Promise<void>;
};

type IdentityOptions = {
  publicUrl: string;
  dataDir: string;
};

export const LOCAL_OWNER: IdentityUser = {
  id: "lotaru-local",
  email: "local@lotaru",
  name: "Lotaru",
  clientId: "lotaru",
};

export async function createIdentity(_options: IdentityOptions): Promise<Identity> {
  async function owner(): Promise<IdentityUser> {
    return LOCAL_OWNER;
  }

  return {
    verifyAccessToken: owner,
    userFrom: owner,
    async register(app): Promise<void> {
      app.get("/api/auth/status", async () => {
        return { mode: "local", hasUsers: true };
      });
      app.get("/api/auth/me", async () => {
        return {
          id: LOCAL_OWNER.id,
          name: LOCAL_OWNER.name,
          email: LOCAL_OWNER.email,
          role: "admin",
          isSystemAdmin: true,
        };
      });
    },
  };
}
