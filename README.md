# Lotaru

Local-only app for projects, tasks, scripts, and notes. Nothing is deployed; it runs on your machine.

```bash
npx -y @umudik/lotaru@latest
```

Opens `http://127.0.0.1:2222` on Windows, macOS, and Linux. Data is `~/.lotaru/app.sqlite`. No login.

That command is the whole app (API + UI). Whisper Docker does **not** start with it. Press **Listen** to start the speech engine; turning Listen off stops the container we started.

- macOS / Apple Silicon: CPU Whisper (`linux/arm64`)
- Windows/Linux with an existing NVIDIA sidecar: that GPU container is reused
- Otherwise: CPU image built on first Listen (Docker Desktop must be running)

```bash
npx -y @umudik/lotaru@latest --port 2222 --data ~/.lotaru
```

| Flag / env | Default | Purpose |
| --- | --- | --- |
| `-p, --port` / `LOTARU_PORT` | `2222` | HTTP port |
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

## Voice → rules → events

Listen writes every transcribed line to `voice_segments`. A couple of minutes' worth of
lines at a time, the scanner reads them against the project's **rules** and emits one
event per match. A rule only decides *that* something was said — it never decides what
happens next:

```
you speak → transcript piles up → scanner matches rules → voice.rule.<id> event
                                                              ↓
                                       agents / scripts subscribed to that event
```

- **Rules** (`/projects/:id/rules`) — name a rule, describe in your own words when it
  should match, and it mints the event type `voice.rule.<id>`. *Scan now* runs the scan
  immediately instead of waiting for the timer; *Try it* matches a pasted transcript
  without emitting anything.
- **Agents** (`/projects/:id/agents`) — run one prompt when an event fires (or daily at a
  set time) and then write a note page, create a task, publish the reply on the bus, or
  just record the run.
- **Scripts** (`/projects/:id/scripts`) — every trigger is a subscription: `scheduled` is
  `clock.tick`, `save` is `file.changed`, `startup` is `app.started`, and `event` picks any
  type by name. The run receives the payload as `LOTARU_EVENT_TYPE`, `LOTARU_EVENT_PATH`,
  `LOTARU_EVENT_DETAIL`, `LOTARU_EVENT_ID`, and `LOTARU_PROJECT_ID`.
- **Doc templates** (`/projects/:id/knowledge/documentation/templates`) — write a document
  each time their event fires.

No event is routed to one subscriber by id, `script.ran` included. The one exception the
bus enforces is that a script never hears its own `script.ran`, which would otherwise spin
forever.

## Agents that write back to the bus

An agent set to **Publish an event** mints `agent.out.<id>` from its title the way a rule
mints `voice.rule.<id>`, and its reply becomes that event's payload. Nothing subscribes by
agent id — a script, another agent, or a doc template picks the event type by name, same
as any other:

```
task.created → agent "Digest" → agent.out.digest → script / agent / doc template
```

This is how one agent hands work to the next. Because agents now hear each other, every
event carries the list of agents it already passed through, and an agent sits out an event
it helped produce — its own output first of all. A cycle stops the first time it comes
back around instead of running forever.

The minted id comes from the title once, at creation, and never moves afterwards, so
renaming an agent cannot strand a subscriber. Deleting one that something still listens
for is refused until the listeners are removed or repointed, and
`/api/agents/:id/subscribers` names them.

## What is kept

Nothing about voice is written to disk as audio — the microphone streams PCM to the
transcriber and only the text lands in SQLite. What the tables keep:

| Table | Window |
| --- | --- |
| `lotaru_events` | newest 2000 per project, and 60 for `clock.tick` |
| `voice_segments` | newest 20 000 lines per project, **scanned ones only** |
| `lotaru_agent_runs` | newest 100 runs per agent, reply capped at 20 000 characters |

The voice window will not close over a line the rule scanner has not read yet. While the
scanner is stalled — the AI engine unreachable, say — the transcript keeps growing rather
than forgetting something you said before any rule saw it. Only the copy of a reply kept
on the run record is capped; the reply that becomes a note, a task, or an event payload is
never cut.

Matching runs on whichever engine **Settings → Agent AI** points at — local Ollama or a
CLI agent. When it is unreachable the scanner leaves the transcript cursor where it is and
retries the same lines on the next pass.

Every match is emitted. The scanner does not decide whether two asks are "the same thing";
subscribers do, and an event arriving while an agent is mid-run waits its turn rather than
being dropped.

An event type with subscribers behaves like a foreign key: the rule cannot be deleted and
its event id cannot be moved until the listeners are removed or repointed. Renaming a rule
never touches the event id. The rule's detail panel lists exactly who is listening.
