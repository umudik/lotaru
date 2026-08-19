# Lotaru

Local-only app for projects, tasks, scripts, and notes. Nothing is deployed; it runs on your machine.

```bash
npm run dev
```

Opens `http://127.0.0.1:4317`. Data is `~/.lotaru/app.sqlite`. No login.

```bash
npx -y @umudik/lotaru --port 4317 --data ~/.lotaru
```

| Flag / env | Default | Purpose |
| --- | --- | --- |
| `-p, --port` / `LOTARU_PORT` | `4317` | HTTP port |
| `-d, --data` / `LOTARU_DATA_DIR` | `~/.lotaru` | SQLite file `app.sqlite`, workspaces, logs |

## From this repo

```bash
npm --prefix apps/task-bridge/apps/backend install
npm --prefix apps/cloud-platform install
npm --prefix packages/cli install
npm run build:lotaru
npx lotaru
```

The unified UI is `apps/cloud-platform` (tasks, scripts, notes). Other folders are the source modules it bundles.
