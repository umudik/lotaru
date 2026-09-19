import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export function parseTunnelPublicUrl(log: string): string {
  const matched = /https:\/\/[a-zA-Z0-9-]+\.(?:trycloudflare\.com|ngrok-free\.app|ngrok\.app|ngrok\.io)/.exec(
    log,
  );
  if (matched === null) {
    return "";
  }
  return matched[0];
}

export function cloudflaredAssetName(platform: string, arch: string): string {
  if (platform === "win32" && arch === "x64") {
    return "cloudflared-windows-amd64.exe";
  }
  if (platform === "win32" && arch === "ia32") {
    return "cloudflared-windows-386.exe";
  }
  if (platform === "linux" && arch === "x64") {
    return "cloudflared-linux-amd64";
  }
  if (platform === "linux" && arch === "arm64") {
    return "cloudflared-linux-arm64";
  }
  if (platform === "darwin" && arch === "arm64") {
    return "cloudflared-darwin-arm64.tgz";
  }
  if (platform === "darwin" && arch === "x64") {
    return "cloudflared-darwin-amd64.tgz";
  }
  return "";
}

export function cloudflaredDownloadUrl(platform: string, arch: string): string {
  const name = cloudflaredAssetName(platform, arch);
  if (name.length === 0) {
    return "";
  }
  return `https://github.com/cloudflare/cloudflared/releases/latest/download/${name}`;
}

export function installCloudflaredBytes(
  bytes: Uint8Array,
  bundled: string,
  assetName: string,
  platformName: string,
): void {
  mkdirSync(dirname(bundled), { recursive: true });
  if (assetName.endsWith(".tgz") !== true) {
    writeFileSync(bundled, Buffer.from(bytes));
    if (platformName !== "win32") {
      chmodSync(bundled, 0o755);
    }
    return;
  }
  const archive = `${bundled}.tgz`;
  writeFileSync(archive, Buffer.from(bytes));
  const unpackedDir = dirname(bundled);
  const unpacked = spawnSync("tar", ["-xzf", archive, "-C", unpackedDir], {
    encoding: "utf8",
  });
  rmSync(archive, { force: true });
  if (unpacked.status !== 0) {
    throw new Error("Could not unpack cloudflared for macOS");
  }
  const extracted = join(unpackedDir, "cloudflared");
  if (existsSync(extracted) !== true) {
    throw new Error("cloudflared archive did not contain a binary");
  }
  if (extracted !== bundled) {
    renameSync(extracted, bundled);
  }
  chmodSync(bundled, 0o755);
}

export function tunnelBinaryFileName(provider: "cloudflare" | "ngrok", platform: string): string {
  if (provider === "ngrok") {
    if (platform === "win32") {
      return "ngrok.exe";
    }
    return "ngrok";
  }
  if (platform === "win32") {
    return "cloudflared.exe";
  }
  return "cloudflared";
}

export function redactSecret(text: string, secret: string): string {
  const trimmed = text.trim();
  if (secret.length === 0) {
    return trimmed;
  }
  const parts = trimmed.split(secret);
  let joined = "";
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) {
      joined = `${joined}[token]`;
    }
    joined = `${joined}${parts[index]}`;
  }
  return joined;
}

export function clipLogTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(text.length - maxChars);
}
