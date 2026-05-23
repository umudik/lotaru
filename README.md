# lotaru

Local-first task orchestration for your machine. Define shell tasks on a project folder, trigger them on save, schedule, or manually, and watch logs in the browser.

## Run

```bash
npx -y @umudik/lotaru@latest
```

Opens http://127.0.0.1:4317 and stores data in `~/.lotaru/`.

### Landing page (dev)

```bash
npm run dev:landing
```

Serves the marketing site at http://localhost:5174 (`packages/landing`).

### Landing deploy (S3)

Pushes to `main` that touch `packages/landing/**` run [.github/workflows/landing-s3.yml](.github/workflows/landing-s3.yml).

**Config (in workflow):** `eu-central-1`, bucket `lotaru-landing` — created on first deploy if missing.

**Repository variable (optional):** `AWS_ROLE_ARN` (OIDC). **Secrets (if not using OIDC):** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

### Requirements

- Node.js 20+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (only for **Docker** runtime tasks)

Shell tasks run on your machine (`gh`, `ollama`, `npm`, etc.). Use **Docker** runtime in a task for an isolated container.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `LOTARU_PORT` | `4317` | HTTP port |
