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
  return "";
}

export function cloudflaredDownloadUrl(platform: string, arch: string): string {
  const name = cloudflaredAssetName(platform, arch);
  if (name.length === 0) {
    return "";
  }
  return `https://github.com/cloudflare/cloudflared/releases/latest/download/${name}`;
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
