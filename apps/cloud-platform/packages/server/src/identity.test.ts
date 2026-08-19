import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyRequest } from "fastify";
import { createIdentity } from "./modules/identity.js";

function emptyRequest(): FastifyRequest {
  return { headers: {} } as FastifyRequest;
}

describe("local identity", () => {
  it("returns the same owner without a token", async () => {
    const identity = await createIdentity({
      publicUrl: "http://127.0.0.1:4317",
      dataDir: "/tmp/lotaru-identity-test",
    });
    const user = await identity.userFrom(emptyRequest());
    assert.equal(user !== null, true);
    if (user === null) {
      return;
    }
    assert.equal(user.id, "lotaru-local");
    assert.equal(user.name, "Lotaru");
  });

  it("verifyAccessToken ignores the token string", async () => {
    const identity = await createIdentity({
      publicUrl: "http://127.0.0.1:4317",
      dataDir: "/tmp/lotaru-identity-test",
    });
    const user = await identity.verifyAccessToken("");
    assert.equal(user.id, "lotaru-local");
  });
});
