# lotaru

Local-first task orchestration for your machine. Define shell tasks on a project folder, trigger them on save, schedule, or manually, and watch logs in the browser.

## Run

```bash
npx -y lotaru@latest
```

Opens http://127.0.0.1:4317 and stores data in `~/.lotaru/`.

### Requirements

- Node.js 20+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (default shell tasks run in an isolated container)

### Host shell (optional)

To use tools installed on your machine (`gh`, `kubectl`, Claude Code, etc.):

```bash
set LOTARU_SHELL_HOST=1
npx lotaru
```

On macOS/Linux use `export LOTARU_SHELL_HOST=1`.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `LOTARU_PORT` | `4317` | HTTP port |
| `LOTARU_NO_OPEN` | — | Set to `1` to skip opening the browser |
| `LOTARU_SHELL_HOST` | — | Set to `1` to run shell tasks on the host |
| `LOTARU_SHELL_IMAGE` | `node:22-alpine` | Docker image for isolated shell tasks |

## Publish setup (maintainers)

1. Create an npm [access token](https://www.npmjs.com/settings/~youruser/tokens) with publish permission (All packages, Read and write, Bypass 2FA if enabled).
2. Add GitHub repository secret **`NPM_TOKEN`** (Settings → Secrets and variables → Actions).
3. Bump `version` in **`packages/cli/package.json`**, push to **`main`** — the publish workflow runs automatically. You can also run it manually from Actions → Publish npm → Run workflow.

Manual first publish:

```bash
npm ci
npm run build:publish
cd packages/cli
npm pack
npm publish
```

## Development

```bash
git clone https://github.com/umudik/lotaru.git
cd lotaru
npm install
npm run dev
```

UI: http://localhost:5173 (proxied to server on 4317)

```bash
npm run build:publish   # production artifact (same as npm publish prep)
npm run typecheck
npm run lint
npm test
```

## Stack

- Backend: Fastify, WebSocket, SQLite, chokidar, node-cron, dockerode
- Frontend: React, Vite, Tailwind
