const ASSET_SUFFIXES = [
  ".js",
  ".css",
  ".map",
  ".wasm",
  ".ico",
  ".svg",
  ".png",
  ".jpg",
  ".woff2",
  ".woff",
  ".json",
];

export function requestPath(url: string): string {
  const parts = url.split("?");
  const pathOnly = parts[0];
  if (pathOnly === undefined) {
    return "/";
  }
  if (pathOnly.length === 0) {
    return "/";
  }
  return pathOnly;
}

export function apiPath(url: string): boolean {
  const pathOnly = requestPath(url);
  if (pathOnly.startsWith("/api/")) {
    return true;
  }
  if (pathOnly === "/healthz") {
    return true;
  }
  if (pathOnly === "/metrics") {
    return true;
  }
  return false;
}

export function apiRouteMissingBody(): { error: string } {
  return {
    error: "API route missing — restart Lotaru so the server loads the latest routes",
  };
}

export function shouldServeSpaIndex(url: string): boolean {
  const pathOnly = requestPath(url);
  if (apiPath(pathOnly)) {
    return false;
  }
  if (pathOnly.startsWith("/assets/")) {
    return false;
  }
  for (const suffix of ASSET_SUFFIXES) {
    if (pathOnly.endsWith(suffix)) {
      return false;
    }
  }
  return true;
}

export function spaFileHeaders(
  res: { setHeader: (name: string, value: string) => unknown },
  filePath: string,
): void {
  const normalised = filePath.replaceAll("\\", "/");
  if (normalised.endsWith("index.html") !== true) {
    return;
  }
  res.setHeader("Cache-Control", "no-store");
}
