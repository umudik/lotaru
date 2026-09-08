import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Globe, Loader2, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useIngestAlarm } from "@/components/IngestAlarmBanner";
import { useSession } from "@/hooks/useSession";
import {
  fetchIngestSettings,
  fetchTunnelSettings,
  restartTunnelSettings,
  saveTunnelSettings,
  type IngestAlarmKind,
  type IngestPollRow,
  type TunnelProvider,
  type TunnelSnapshot,
  type TunnelState,
} from "@/lib/api";

function statusBadge(state: TunnelState): { variant: "muted" | "running" | "success" | "warn" | "destructive"; label: string } {
  if (state === "up") {
    return { variant: "success", label: "Live" };
  }
  if (state === "starting") {
    return { variant: "running", label: "Starting" };
  }
  if (state === "missing_binary") {
    return { variant: "warn", label: "Needs client" };
  }
  if (state === "error") {
    return { variant: "destructive", label: "Down" };
  }
  return { variant: "muted", label: "Off" };
}

function catchUpBadge(polls: readonly IngestPollRow[], alarmKind: IngestAlarmKind): {
  variant: "muted" | "success" | "warn" | "destructive";
  label: string;
  detail: string;
} {
  let lagged = false;
  let error = "";
  let primed = false;
  for (const row of polls) {
    if (row.lagged) {
      lagged = true;
    }
    if (row.lastError.length > 0) {
      error = row.lastError;
    }
    if (row.primed) {
      primed = true;
    }
  }
  if (alarmKind === "poll_error" || error.length > 0) {
    let detail = error;
    if (detail.length === 0) {
      detail = "A connected tool poll failed.";
    }
    return { variant: "destructive", label: "Poll error", detail };
  }
  if (alarmKind === "behind" || lagged) {
    return {
      variant: "warn",
      label: "Behind",
      detail: "Catch-up is draining the backlog a page at a time. Newer events are kept; the rest is not skipped.",
    };
  }
  if (primed) {
    return {
      variant: "success",
      label: "Catching up",
      detail: "Poll walks from the last cursor with a two-minute overlap, so a short disconnect does not drop a lot.",
    };
  }
  return {
    variant: "muted",
    label: "Idle",
    detail: "Connect a tool with a list API (GitHub, Notion, Linear, Stripe, RSS) to start catch-up polling.",
  };
}

export function WebhookTunnelSettings(): React.JSX.Element {
  const session = useSession();
  const alarm = useIngestAlarm();
  const [tunnel, setTunnel] = useState<TunnelSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [ngrokToken, setNgrokToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [polls, setPolls] = useState<IngestPollRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    let announced = false;
    async function load(): Promise<void> {
      try {
        const data = await fetchTunnelSettings(session);
        if (cancelled !== true) {
          setTunnel(data.tunnel);
          announced = true;
        }
        try {
          const ingest = await fetchIngestSettings(session);
          if (cancelled !== true) {
            setPolls(ingest.polls);
          }
        } catch {
          return;
        }
      } catch (err) {
        if (cancelled === true || announced === true) {
          return;
        }
        announced = true;
        toast.error(err instanceof Error ? err.message : "Failed to load tunnel");
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
  }, [session]);

  async function persist(input: {
    enabled: boolean;
    provider: TunnelProvider;
    ngrokToken: string;
  }): Promise<void> {
    setSaving(true);
    try {
      const data = await saveTunnelSettings(session, input);
      setTunnel(data.tunnel);
      if (input.ngrokToken.trim().length > 0) {
        setNgrokToken("");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save tunnel");
    } finally {
      setSaving(false);
    }
  }

  async function restart(): Promise<void> {
    setSaving(true);
    try {
      const data = await restartTunnelSettings(session);
      setTunnel(data.tunnel);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to restart tunnel");
    } finally {
      setSaving(false);
    }
  }

  async function copyUrl(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Copied public URL");
      window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      toast.error("Could not copy — select and copy manually");
    }
  }

  if (tunnel === null) {
    return (
      <section id="tunnel" className="panel-card space-y-5 p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading tunnel…
        </div>
      </section>
    );
  }

  const badge = statusBadge(tunnel.state);
  const catchUp = catchUpBadge(polls, alarm.kind);
  const busy = saving || tunnel.state === "starting";
  const url = tunnel.publicUrl;
  let detailClass = "text-xs text-muted-foreground";
  if (tunnel.state === "error" || tunnel.state === "missing_binary") {
    detailClass = "text-xs text-destructive";
  }

  return (
    <section id="tunnel" className="panel-card space-y-5 p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
          <Globe className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Webhook tunnel</h2>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Starts with Lotaru. Poll is the catch-up path so a dropped tunnel does not lose a short
            outage. Instant webhooks use this public URL. A huge backlog is drained across ticks, not dumped.
          </p>
        </div>
        <Switch
          id="tunnel-enabled"
          checked={tunnel.enabled}
          disabled={busy}
          onCheckedChange={(checked) => {
            void persist({
              enabled: checked === true,
              provider: tunnel.provider,
              ngrokToken: "",
            });
          }}
        />
      </div>
      <div className="space-y-4 border-t border-border/60 pt-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">Provider</p>
          <div className="flex shrink-0 rounded-lg border border-border/70 p-0.5">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              variant={tunnel.provider === "cloudflare" ? "secondary" : "ghost"}
              onClick={() => {
                void persist({
                  enabled: tunnel.enabled,
                  provider: "cloudflare",
                  ngrokToken: "",
                });
              }}
            >
              Cloudflare
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              variant={tunnel.provider === "ngrok" ? "secondary" : "ghost"}
              onClick={() => {
                void persist({
                  enabled: tunnel.enabled,
                  provider: "ngrok",
                  ngrokToken: "",
                });
              }}
            >
              ngrok
            </Button>
          </div>
        </div>
        {tunnel.provider === "cloudflare" ? (
          <p className="text-xs text-muted-foreground">
            Uses a Quick Tunnel. No account. The URL changes each time Lotaru starts.
          </p>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="ngrok-token">ngrok authtoken</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="ngrok-token"
                type="password"
                autoComplete="off"
                value={ngrokToken}
                disabled={busy}
                placeholder={
                  tunnel.ngrokConfigured ? "Paste a new token to replace" : "ngrok authtoken"
                }
                onChange={(event) => {
                  setNgrokToken(event.target.value);
                }}
              />
              <Button
                type="button"
                disabled={busy || ngrokToken.trim().length === 0}
                onClick={() => {
                  void persist({
                    enabled: tunnel.enabled,
                    provider: "ngrok",
                    ngrokToken,
                  });
                }}
              >
                Save token
              </Button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="tunnel-url">Public URL</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="tunnel-url"
              readOnly
              value={url}
              placeholder={tunnel.state === "starting" ? "Waiting for public URL…" : "Not published"}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              disabled={url.length === 0}
              onClick={() => {
                void copyUrl(url);
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              Copy
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || tunnel.enabled !== true}
              onClick={() => {
                void restart();
              }}
            >
              {tunnel.state === "starting" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4" />
              )}
              Restart
            </Button>
          </div>
        </div>
        {tunnel.detail.length > 0 ? <p className={detailClass}>{tunnel.detail}</p> : null}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Catch-up poll</p>
            <Badge variant={catchUp.variant}>{catchUp.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{catchUp.detail}</p>
        </div>
      </div>
    </section>
  );
}
