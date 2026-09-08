import { z } from "zod";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "host.docker.internal"];

function trimBase(base: string): string {
  return base.trim().replace(/\/$/, "");
}

export function assertLocalAiBase(base: string): string {
  const trimmed = trimBase(base);
  if (trimmed.length === 0) {
    throw new Error("Set a local AI host");
  }
  const parsed = z.string().url().safeParse(trimmed);
  if (parsed.success !== true) {
    throw new Error("Local AI host must be a URL");
  }
  const url = new URL(parsed.data);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Local AI host must be http or https");
  }
  let allowed = false;
  for (const host of LOCAL_HOSTS) {
    if (url.hostname === host) {
      allowed = true;
    }
  }
  if (allowed !== true) {
    throw new Error("Local AI host must be this machine (localhost)");
  }
  return trimmed;
}

export function assertHttpsAiBase(base: string): string {
  const trimmed = trimBase(base);
  if (trimmed.length === 0) {
    throw new Error("Cloud AI endpoint missing");
  }
  const parsed = z.string().url().safeParse(trimmed);
  if (parsed.success !== true) {
    throw new Error("Cloud AI endpoint must be a URL");
  }
  const url = new URL(parsed.data);
  if (url.protocol !== "https:") {
    throw new Error("Cloud AI endpoint must be https");
  }
  return trimmed;
}
