export function parseHostRuntime(requested: unknown): "shell" | "invalid" {
  if (requested === undefined) {
    return "shell";
  }
  if (requested === "shell") {
    return "shell";
  }
  if (requested === "docker") {
    return "shell";
  }
  return "invalid";
}
