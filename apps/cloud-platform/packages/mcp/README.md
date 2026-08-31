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

`projects_list`, `events_*`, `voice_*`, `voice_rules`, `voice_rules_scan`, `voice_rules_test`, `note_books_*`, `note_page_append`, `note_page_speak`, `agents_list`, `agents_create`, `agents_patch`, `agents_delete`, `agents_run`, `agents_runs`, `scripts_*`, `tasks_list`, `pipeline_get`, `settings_*`, `knowledge_*`.

`agents_create` and `agents_patch` take an `action`: `none`, `note`, `task`, or `event`. An
agent with `action: "event"` publishes its reply on the bus as `agent.out.<slug>`, which
anything else can subscribe to by name.

`note_page_speak` calls `POST /api/note-pages/:pageId/speak` and returns MCP `audio` content (base64 MP3) plus JSON metadata. Use `note_book_get` to find `pageId` values.
