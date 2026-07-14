import { createRemoteJWKSet, jwtVerify } from 'jose';

const AUTH_ISSUER = process.env['FOOKIE_AUTH_ISSUER'] ?? 'https://auth.fookiecloud.com';
const CLIENT_ID = process.env['LOTARU_CLIENT_ID'] ?? 'lotaru';
const JWKS_URL = new URL(`${AUTH_ISSUER}/.well-known/jwks.json`);

const jwks = createRemoteJWKSet(JWKS_URL);

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  clientId: string;
}

export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: AUTH_ISSUER,
    algorithms: ['RS256'],
  });
  const sub = payload.sub;
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('missing sub');
  }
  const clientId =
    typeof payload['client_id'] === 'string'
      ? payload['client_id']
      : Array.isArray(payload.aud)
        ? String(payload.aud[0] ?? '')
        : typeof payload.aud === 'string'
          ? payload.aud
          : '';
  if (clientId !== CLIENT_ID) {
    throw new Error('invalid client');
  }
  return {
    id: sub,
    email: typeof payload['email'] === 'string' ? payload['email'] : null,
    name: typeof payload['name'] === 'string' ? payload['name'] : null,
    clientId,
  };
}

export function bearerFromHeader(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') {
    return null;
  }
  if (!header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  if (token.length === 0) {
    return null;
  }
  return token;
}

export { AUTH_ISSUER, CLIENT_ID };
