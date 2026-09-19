import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const cloudPlatformRoot = join(here, "..");
const repoRoot = join(cloudPlatformRoot, "..", "..");
const cliRoot = join(repoRoot, "packages", "cli");
const serverDist = join(cloudPlatformRoot, "packages", "server", "dist");
const webDist = join(cloudPlatformRoot, "packages", "web", "dist");
const taskBridgeRoot = join(repoRoot, "apps", "task-bridge", "apps", "backend");
const taskBridgeDist = join(taskBridgeRoot, "dist");

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

function pruneDir(dir) {
  if (!existsSync(dir)) {
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      pruneDir(p);
      continue;
    }
    if (entry.name.endsWith(".test.js") || entry.name.endsWith(".map")) {
      rmSync(p);
    }
  }
}

function copyInto(src, dest) {
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  pruneDir(dest);
}

run("npm run build", taskBridgeRoot);
run("npm run build:web", cloudPlatformRoot);

if (existsSync(serverDist)) {
  rmSync(serverDist, { recursive: true, force: true });
}
run("npx tsc -p packages/server/tsconfig.json", cloudPlatformRoot);
if (!existsSync(join(serverDist, "index.js"))) {
  console.error("[build-publish] server dist missing");
  process.exit(1);
}
pruneDir(serverDist);

if (!existsSync(join(webDist, "index.html"))) {
  console.error("[build-publish] web dist missing");
  process.exit(1);
}

if (!existsSync(join(taskBridgeDist, "index.js"))) {
  console.error("[build-publish] task-bridge dist missing");
  process.exit(1);
}

copyInto(serverDist, join(cliRoot, "apps", "cloud-platform", "packages", "server", "dist"));
copyInto(webDist, join(cliRoot, "apps", "cloud-platform", "packages", "web", "dist"));
copyInto(taskBridgeDist, join(cliRoot, "apps", "task-bridge", "apps", "backend", "dist"));
copyInto(join(cloudPlatformRoot, "voice-sidecar"), join(cliRoot, "apps", "cloud-platform", "voice-sidecar"));

run("npm run build", cliRoot);

if (!existsSync(join(cliRoot, "dist", "index.js"))) {
  console.error("[build-publish] cli dist missing");
  process.exit(1);
}

console.log("[build-publish] lotaru bundle ready");
