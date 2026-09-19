#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type StartOptions = {
  port: number;
  host: string;
  dataDir: string;
  staticDir: string | null;
};

type ServerModule = {
  resolveStartOptions(
    argv: readonly string[],
    env: NodeJS.ProcessEnv,
    homeDir: string,
  ): StartOptions;
  start(opts: StartOptions): Promise<{ url: string }>;
};

function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function bundledServerPath(): string {
  return join(
    packageRoot(),
    "apps",
    "cloud-platform",
    "packages",
    "server",
    "dist",
    "index.js",
  );
}

function bundledWebPath(): string {
  return join(packageRoot(), "apps", "cloud-platform", "packages", "web", "dist");
}

function printHelp(): void {
  console.log(`lotaru — local task, script, and notes app

Usage:
  npx @umudik/lotaru
  npx @umudik/lotaru --port 2222 --data ~/.lotaru

Options:
  -p, --port   Listen port (default 2222, or $LOTARU_PORT)
  -d, --data   Data directory (default ~/.lotaru, or $LOTARU_DATA_DIR)
  -h, --help   Show this help
`);
}

function openBrowser(url: string): void {
  let child;
  if (process.platform === "win32") {
    child = spawn("cmd", ["/c", "start", "", url.replaceAll("&", "^&")], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
  } else if (process.platform === "darwin") {
    child = spawn("open", [url], { detached: true, stdio: "ignore" });
  } else {
    child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  }
  child.unref();
}

async function loadServer(): Promise<ServerModule> {
  const bundled = bundledServerPath();
  if (!existsSync(bundled)) {
    throw new Error(`lotaru server bundle missing at ${bundled}; run build:publish`);
  }
  const mod = (await import(pathToFileURL(bundled).href)) as ServerModule;
  return mod;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  const server = await loadServer();
  const opts = server.resolveStartOptions(argv, process.env, homedir());
  const webDir = bundledWebPath();
  if (existsSync(join(webDir, "index.html"))) {
    opts.staticDir = webDir;
  }
  process.env.NODE_ENV = "production";
  const started = await server.start(opts);
  console.log(`\n  Lotaru\n  → ${started.url}\n`);
  openBrowser(started.url);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
