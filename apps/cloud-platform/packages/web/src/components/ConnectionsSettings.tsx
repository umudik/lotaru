import { useEffect, useState } from "react";
import { Check, ChevronRight, Copy, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { ConnectorLogo } from "@/components/ConnectorLogo";
import { EventTypesTable } from "@/components/EventTypesTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/useSession";
import {
  fetchIngestSettings,
  fetchTunnelSettings,
  type ConnectorRow,
  type IngestHookRow,
  type IngestHookSyncRow,
} from "@/lib/api";
import { useIngestAlarm } from "@/components/IngestAlarmBanner";

function connectorAlarmed(connectors: readonly string[], id: string): boolean {
  for (const listed of connectors) {
    if (listed === id) {
      return true;
    }
  }
  return false;
}

function visibleConnectors(
  rows: readonly ConnectorRow[],
  query: string,
  linkedOnly: boolean,
): ConnectorRow[] {
  const needle = query.trim().toLowerCase();
  const matched: ConnectorRow[] = [];
  for (const row of rows) {
    if (linkedOnly && row.connected !== true) {
      continue;
    }
    const hay = `${row.label} ${row.id}`.toLowerCase();
    if (needle.length > 0 && hay.includes(needle) !== true) {
      continue;
    }
    matched.push(row);
  }
  matched.sort((left: ConnectorRow, right: ConnectorRow) => {
    if (left.connected === right.connected) {
      return left.label.localeCompare(right.label);
    }
    if (left.connected) {
      return -1;
    }
    return 1;
  });
  return matched;
}

function connectedCount(rows: readonly ConnectorRow[]): number {
  let count = 0;
  for (const row of rows) {
    if (row.connected) {
      count += 1;
    }
  }
  return count;
}

function secretPlaceholder(row: ConnectorRow): string {
  if (row.id === "github") {
    if (row.connected) {
      return "Paste a new token to replace";
    }
    return "ghp_…";
  }
  if (row.id === "jira") {
    if (row.connected) {
      return "Paste a new site email and token to replace";
    }
    return "https://yoursite.atlassian.net you@email API_TOKEN";
  }
  if (row.connected) {
    return "Paste a new token to replace";
  }
  return "API token";
}

export function ConnectionsSettings(props: {
  connectors: ConnectorRow[];
  githubToken: string;
  githubSaving: boolean;
  onGithubToken: (token: string) => void;
  onSaveGithub: () => void;
  secrets: Record<string, string>;
  savingId: string;
  onSecret: (id: string, secret: string) => void;
  onSave: (id: string) => void;
  focusId: string;
}): React.JSX.Element {
  const session = useSession();
  const [query, setQuery] = useState("");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [openToolId, setOpenToolId] = useState("");
  const [hooks, setHooks] = useState<IngestHookRow[]>([]);
  const [hookSync, setHookSync] = useState<IngestHookSyncRow[]>([]);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [notionVerificationToken, setNotionVerificationToken] = useState("");
  const alarm = useIngestAlarm();
  useEffect(() => {
    const hash = props.focusId;
    if (hash.length === 0 || hash === "connections") {
      return;
    }
    setOpenToolId(hash);
  }, [props.focusId]);
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const ingest = await fetchIngestSettings(session);
        const tunnel = await fetchTunnelSettings(session);
        if (cancelled === true) {
          return;
        }
        setHooks(ingest.hooks);
        setHookSync(ingest.hookSync);
        setNotionVerificationToken(ingest.notionVerificationToken);
        setTunnelUrl(tunnel.tunnel.publicUrl);
      } catch {
        return;
      }
    }
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session, props.connectors]);
  const listed = visibleConnectors(props.connectors, query, linkedOnly);
  const linked = connectedCount(props.connectors);
  return (
    <section id="connections" className="panel-card space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Save a token to unlock that tool’s events. Poll catches up from a cursor. When the tunnel
          is live, each connected tool also gets an inbound webhook URL.
        </p>
        <Badge variant={linked > 0 ? "success" : "muted"}>{`${linked} connected`}</Badge>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="connection-search"
            value={query}
            placeholder="Search tools"
            className="pl-9"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <div className="flex shrink-0 rounded-lg border border-border/70 p-0.5">
          <Button
            type="button"
            size="sm"
            variant={linkedOnly ? "ghost" : "secondary"}
            onClick={() => {
              setLinkedOnly(false);
            }}
          >
            All
          </Button>
          <Button
            type="button"
            size="sm"
            variant={linkedOnly ? "secondary" : "ghost"}
            onClick={() => {
              setLinkedOnly(true);
            }}
          >
            Connected
          </Button>
        </div>
      </div>
      {listed.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {linkedOnly ? "No connected tools match." : "No tools match that search."}
        </p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-xl border border-border/60">
          {listed.map((row, index) => {
            const draft = props.secrets[row.id];
            const secretValue = draft === undefined ? "" : draft;
            const isGithub = row.id === "github";
            const tokenValue = isGithub ? props.githubToken : secretValue;
            const saving = isGithub ? props.githubSaving : props.savingId === row.id;
            const placeholder = secretPlaceholder(row);
            return (
              <li key={row.id}>
                <details
                  id={row.id}
                  name="lotaru-connection"
                  className="connection-tool"
                  open={props.focusId === row.id ? true : undefined}
                  onToggle={(event) => {
                    if (event.currentTarget.open) {
                      setOpenToolId(row.id);
                      return;
                    }
                    if (openToolId === row.id) {
                      setOpenToolId("");
                    }
                  }}
                >
                  <summary className="connection-summary flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronRight className="connection-chevron h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <ConnectorLogo id={row.id} label={row.label} eager={index < 10} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{row.label}</span>
                      <span className="block text-[11px] tabular-nums text-muted-foreground">
                        {`${row.events.length} events`}
                      </span>
                    </span>
                    {row.connected ? (
                      <span className="flex items-center gap-1.5">
                        {connectorAlarmed(alarm.connectors, row.id) && alarm.kind === "behind" ? (
                          <Badge variant="warn">Behind</Badge>
                        ) : null}
                        {connectorAlarmed(alarm.connectors, row.id) && alarm.kind === "poll_error" ? (
                          <Badge variant="destructive">Poll error</Badge>
                        ) : null}
                        <Badge variant="success">Connected</Badge>
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Connect</span>
                    )}
                  </summary>
                  <div className="space-y-3 px-3 pb-3 pt-1">
                    <Label htmlFor={`${row.id}-secret`} className="sr-only">
                      Token
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id={`${row.id}-secret`}
                        type="password"
                        value={tokenValue}
                        placeholder={placeholder}
                        aria-describedby={row.id === "jira" ? `${row.id}-secret-hint` : undefined}
                        onChange={(event) => {
                          if (isGithub) {
                            props.onGithubToken(event.target.value);
                            return;
                          }
                          props.onSecret(row.id, event.target.value);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => {
                          if (isGithub) {
                            props.onSaveGithub();
                            return;
                          }
                          props.onSave(row.id);
                        }}
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {row.connected ? "Update" : "Connect"}
                      </Button>
                    </div>
                    {row.id === "jira" ? (
                      <p id={`${row.id}-secret-hint`} className="text-xs text-muted-foreground">
                        Site URL, Atlassian email, and API token, separated by spaces. Poll walks
                        issues from the last cursor.
                      </p>
                    ) : null}
                    {row.connected && openToolId === row.id ? (
                      <InboundHookUrl
                        connectorId={row.id}
                        hooks={hooks}
                        hookSync={hookSync}
                        tunnelUrl={tunnelUrl}
                        notionVerificationToken={notionVerificationToken}
                      />
                    ) : null}
                    {openToolId === row.id || props.focusId === row.id ? (
                      <EventTypesTable
                        includeKind={false}
                        rows={row.events.map((listed) => ({
                          type: listed.type,
                          label: listed.label,
                          kind: "connection",
                          sourceId: row.id,
                          sourceLabel: row.label,
                        }))}
                      />
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function hookUrlFor(
  connectorId: string,
  hooks: readonly IngestHookRow[],
  tunnelUrl: string,
): { url: string; waiting: string } {
  if (tunnelUrl.length === 0) {
    return {
      url: "",
      waiting: "Inbound URL appears when the webhook tunnel is live.",
    };
  }
  let token = "";
  for (const hook of hooks) {
    if (hook.connectorId === connectorId) {
      token = hook.token;
      break;
    }
  }
  if (token.length === 0) {
    return { url: "", waiting: "Saving the token mints a secret inbound path." };
  }
  const base = tunnelUrl.endsWith("/") ? tunnelUrl.slice(0, -1) : tunnelUrl;
  return { url: `${base}/api/ingest/hooks/${token}`, waiting: "" };
}

function githubRegisterNote(
  connectorId: string,
  ingestUrl: string,
  hookSync: readonly IngestHookSyncRow[],
): { tone: "ok" | "error" | "wait"; text: string } {
  if (connectorId === "slack") {
    return {
      tone: "wait",
      text: "Paste this URL as the Slack Events Request URL. Slack has no list catch-up; a missed message is gone.",
    };
  }
  if (connectorId === "jira") {
    return {
      tone: "wait",
      text: "Paste this URL in Jira incoming webhooks. Poll still catches issues from the last cursor.",
    };
  }
  if (connectorId === "notion") {
    return {
      tone: "wait",
      text: "Paste this URL in the Notion integration webhook. After Notion POSTs, copy the verification token below.",
    };
  }
  if (connectorId === "github" || connectorId === "linear" || connectorId === "stripe") {
    return autoRegisterNote(connectorId, ingestUrl, hookSync);
  }
  return {
    tone: "wait",
    text: "Instant push while the tunnel is up. Poll still catches a short outage from the last cursor.",
  };
}

function autoRegisterNote(
  connectorId: string,
  ingestUrl: string,
  hookSync: readonly IngestHookSyncRow[],
): { tone: "ok" | "error" | "wait"; text: string } {
  let vendor = "GitHub";
  if (connectorId === "linear") {
    vendor = "Linear";
  } else if (connectorId === "stripe") {
    vendor = "Stripe";
  }
  let error = "";
  let registered = 0;
  let listed = 0;
  for (const row of hookSync) {
    if (row.connector !== connectorId) {
      continue;
    }
    listed += 1;
    if (row.lastError.length > 0) {
      error = row.lastError;
      continue;
    }
    if (row.url === ingestUrl) {
      registered += 1;
    }
  }
  if (error.length > 0) {
    return { tone: "error", text: error };
  }
  if (listed > 0 && registered === listed) {
    return {
      tone: "ok",
      text: `Registered on ${vendor}. A new tunnel URL is pushed automatically.`,
    };
  }
  if (connectorId === "github") {
    return {
      tone: "wait",
      text: "Lotaru registers this URL on watched GitHub repositories. Poll still catches a short outage.",
    };
  }
  return {
    tone: "wait",
    text: `Lotaru registers this URL on ${vendor}. Poll still catches a short outage from the last cursor.`,
  };
}

function InboundHookUrl(props: {
  connectorId: string;
  hooks: readonly IngestHookRow[];
  hookSync: readonly IngestHookSyncRow[];
  tunnelUrl: string;
  notionVerificationToken: string;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [copiedVerify, setCopiedVerify] = useState(false);
  const built = hookUrlFor(props.connectorId, props.hooks, props.tunnelUrl);
  if (built.url.length === 0) {
    return <p className="text-xs text-muted-foreground">{built.waiting}</p>;
  }
  const note = githubRegisterNote(props.connectorId, built.url, props.hookSync);
  const showNotionVerify = props.connectorId === "notion" && props.notionVerificationToken.length > 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Label htmlFor={`${props.connectorId}-hook-url`}>Inbound webhook</Label>
        {note.tone === "ok" ? <Badge variant="success">Registered</Badge> : null}
        {note.tone === "error" ? <Badge variant="destructive">Register error</Badge> : null}
      </div>
      <div className="flex gap-2">
        <Input
          id={`${props.connectorId}-hook-url`}
          type="url"
          readOnly
          value={built.url}
          className="font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(built.url).then(
              () => {
                setCopied(true);
                toast.success("Copied inbound URL");
                window.setTimeout(() => {
                  setCopied(false);
                }, 1500);
              },
              () => {
                toast.error("Could not copy");
              },
            );
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          Copy
        </Button>
      </div>
      <p
        className={note.tone === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
        role={note.tone === "error" ? "alert" : "status"}
      >
        {note.text}
      </p>
      {showNotionVerify ? (
        <div className="space-y-1 pt-2">
          <Label htmlFor="notion-verification-token">Notion verification token</Label>
          <div className="flex gap-2">
            <Input
              id="notion-verification-token"
              readOnly
              value={props.notionVerificationToken}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(props.notionVerificationToken).then(
                  () => {
                    setCopiedVerify(true);
                    toast.success("Copied verification token");
                    window.setTimeout(() => {
                      setCopiedVerify(false);
                    }, 1500);
                  },
                  () => {
                    toast.error("Could not copy");
                  },
                );
              }}
            >
              {copiedVerify ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" role="status">
            Paste this token in Notion to finish the webhook subscription.
          </p>
        </div>
      ) : null}
    </div>
  );
}
