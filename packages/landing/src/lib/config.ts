const AUTH = 'https://auth.fookiecloud.com';
const CLIENT_ID = 'lotaru';
const REDIRECT_URI = 'https://lotaru.fookiecloud.com/callback';
const GITHUB_URL = 'https://github.com/umudik/lotaru';
const INSTALL_CMD = 'npx -y @umudik/lotaru@latest';

function signInUrl(): string {
  const state = crypto.randomUUID();
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
  });
  return `${AUTH}/v1/login?${q.toString()}`;
}

export { AUTH, CLIENT_ID, REDIRECT_URI, GITHUB_URL, INSTALL_CMD, signInUrl };
