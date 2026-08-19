const ACCESS_KEY = "fookie_access_token";

export function isCloudHost(): boolean {
  return true;
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function setAccessToken(token: string): void {
  localStorage.setItem(ACCESS_KEY, token);
}

export function clearFookieTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
}
