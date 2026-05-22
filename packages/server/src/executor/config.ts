export const DEFAULT_SHELL_IMAGE = 'node:22-alpine';

export function defaultShellImage(): string {
  const env = process.env['LOTARU_SHELL_IMAGE'];
  if (typeof env === 'string' && env.length > 0) {
    return env;
  }
  return DEFAULT_SHELL_IMAGE;
}

export function shellRunsOnHost(): boolean {
  return process.env['LOTARU_SHELL_HOST'] === '1';
}
