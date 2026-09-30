# Lotaru local MCP

Auth-free MCP for the local Lotaru process. Cursor connects with a URL or stdio — no OAuth, no API key.

## HTTP

```bash
cd apps/cloud-platform/packages/mcp
npm install && npm run build
LOTARU_URL=http://127.0.0.1:2222 LOTARU_MCP_HTTP=1 node dist/index.js --http
```

Default listen address is `127.0.0.1:18766`.

```json
{
  "mcpServers": {
    "lotaru-local": {
      "url": "http://127.0.0.1:18766/mcp"
    }
  }
}
```

## Stdio

```bash
cd apps/cloud-platform/packages/mcp
npm install && npm run build
LOTARU_URL=http://127.0.0.1:2222 node dist/index.js
```

## Tools

`projects_list`, `events_*`, `note_books_*`, `note_page_append`, `note_page_speak`, `speak`, `agents_list`, `agents_create`, `agents_patch`, `agents_delete`, `agents_run`, `agents_runs`, `scripts_*`, `tasks_list`, `pipeline_get`, `settings_*`, `knowledge_*`.

`agents_create` and `agents_patch` take an `action`: `none`, `note`, `task`, or `event`. An
agent with `action: "event"` publishes its reply on the bus as `agent.out.<slug>`, which
anything else can subscribe to by name.

`note_page_append` creates a page and queues it on Speak. Pass `speak: false` to skip audio. `speak` reads any text. `note_page_speak` reads an existing page variant. Turn Speak on in the Lotaru sidebar so queued audio plays on the machine.
