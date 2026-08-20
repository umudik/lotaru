# Lotaru local MCP

Auth-free Streamable HTTP MCP for the Lotaru docker stack. Cursor connects with a URL only — no OAuth, no API key.

## Docker Compose

`docker-compose.yml` runs `lotaru-mcp` on `127.0.0.1:18766`.

```json
{
  "mcpServers": {
    "lotaru-local": {
      "url": "http://127.0.0.1:18766/mcp"
    }
  }
}
```

Env inside the container:

- `LOTARU_URL=http://fookie-cloud:8080` (API target)
- no `LOTARU_API_KEY` (local identity already accepts requests)

## Stdio (dev)

```bash
cd apps/cloud-platform/packages/mcp
npm install && npm run build
LOTARU_URL=http://127.0.0.1:11222 node dist/index.js
```

## Tools

`projects_list`, `events_*`, `voice_*`, `note_books_*`, `note_page_append`, `agents_list`, `agents_run`, `agents_runs`, `scripts_*`, `tasks_list`, `pipeline_get`, `reactions_*`.
