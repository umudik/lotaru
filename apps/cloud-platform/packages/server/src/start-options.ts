import { join } from "node:path";

export type StartOptions = {
  port: number;
  host: string;
  dataDir: string;
  staticDir: string | null;
};

type EnvMap = Record<string, string | undefined>;

const DEFAULT_PORT = 4317;
const DEFAULT_HOST = "127.0.0.1";

function parsePort(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  if (raw.length === 0) {
    return null;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    return null;
  }
  if (n < 1) {
    return null;
  }
  if (n > 65535) {
    return null;
  }
  return n;
}

function flagValue(argv: readonly string[], longName: string, shortName: string): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === longName || token === shortName) {
      const next = argv[i + 1];
      if (next === undefined) {
        return null;
      }
      if (next.length === 0) {
        return null;
      }
      return next;
    }
  }
  return null;
}

function envValue(env: EnvMap, key: string): string | null {
  const value = env[key];
  if (value === undefined) {
    return null;
  }
  if (value.length === 0) {
    return null;
  }
  return value;
}

export function resolveStartOptions(
  argv: readonly string[],
  env: EnvMap,
  homeDir: string,
): StartOptions {
  let port = DEFAULT_PORT;
  const envPortLegacy = parsePort(envValue(env, "PORT"));
  if (envPortLegacy !== null) {
    port = envPortLegacy;
  }
  const envPort = parsePort(envValue(env, "LOTARU_PORT"));
  if (envPort !== null) {
    port = envPort;
  }
  const argPort = parsePort(flagValue(argv, "--port", "-p"));
  if (argPort !== null) {
    port = argPort;
  }

  let host = DEFAULT_HOST;
  const envHostLegacy = envValue(env, "HOST");
  if (envHostLegacy !== null) {
    host = envHostLegacy;
  }
  const envHost = envValue(env, "LOTARU_HOST");
  if (envHost !== null) {
    host = envHost;
  }
  const argHost = flagValue(argv, "--host", "-h");
  if (argHost !== null) {
    host = argHost;
  }

  let dataDir = join(homeDir, ".lotaru");
  const envDataLegacy = envValue(env, "DATA_DIR");
  if (envDataLegacy !== null) {
    dataDir = envDataLegacy;
  }
  const envData = envValue(env, "LOTARU_DATA_DIR");
  if (envData !== null) {
    dataDir = envData;
  }
  const argData = flagValue(argv, "--data", "-d");
  if (argData !== null) {
    dataDir = argData;
  }

  return {
    port,
    host,
    dataDir,
    staticDir: null,
  };
}
