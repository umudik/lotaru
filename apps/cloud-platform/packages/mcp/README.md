# Lotaru local MCP

Point Cursor at your running Lotaru (`http://127.0.0.1:4317`).

```json
{
  "mcpServers": {
    "lotaru-local": {
      "command": "node",
      "args": ["apps/cloud-platform/packages/mcp/dist/index.js"],
      "env": {
        "LOTARU_URL": "http://127.0.0.1:4317"
      }
    }
  }
}
```

Build:

```bash
cd apps/cloud-platform/packages/mcp
npm install
npm run build
```

Tools: `events_list`, `events_replay`, `reactions_*`, `scripts_list`, `script_snapshot`, `scripts_run`, `script_execution_log`, `tasks_list`, `pipeline_get`, `voice_segments`, `voice_decisions`, `voice_status`, `projects_list`.

Example: “Bugün ne konuştum?” → `voice_segments` + `voice_decisions` for the project id.
