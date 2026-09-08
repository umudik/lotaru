import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { fetchIngestSettings, type IngestAlarm } from "@/lib/api";

const quietAlarm: IngestAlarm = {
  kind: "ok",
  title: "",
  detail: "",
  connectors: [],
};

const IngestAlarmContext = createContext<IngestAlarm>(quietAlarm);

export function useIngestAlarm(): IngestAlarm {
  return useContext(IngestAlarmContext);
}

function alarmUnchanged(current: IngestAlarm, next: IngestAlarm): boolean {
  if (current.kind !== next.kind) {
    return false;
  }
  if (current.title !== next.title) {
    return false;
  }
  if (current.detail !== next.detail) {
    return false;
  }
  if (current.connectors.length !== next.connectors.length) {
    return false;
  }
  for (let index = 0; index < current.connectors.length; index += 1) {
    if (current.connectors[index] !== next.connectors[index]) {
      return false;
    }
  }
  return true;
}

function announceAlarm(alarm: IngestAlarm): void {
  if (alarm.kind === "ok") {
    toast.dismiss("lotaru-ingest-alarm");
    return;
  }
  if (alarm.kind === "poll_error") {
    toast.error(alarm.title, {
      id: "lotaru-ingest-alarm",
      description: alarm.detail,
      duration: Number.POSITIVE_INFINITY,
    });
    return;
  }
  toast.warning(alarm.title, {
    id: "lotaru-ingest-alarm",
    description: alarm.detail,
    duration: Number.POSITIVE_INFINITY,
  });
}

export function IngestAlarmProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const session = useSession();
  const [alarm, setAlarm] = useState<IngestAlarm>(quietAlarm);
  const lastKind = useRef<IngestAlarm["kind"]>("ok");
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const data = await fetchIngestSettings(session);
        if (cancelled === true) {
          return;
        }
        setAlarm((current) => {
          if (alarmUnchanged(current, data.alarm)) {
            return current;
          }
          return data.alarm;
        });
        if (data.alarm.kind !== lastKind.current) {
          lastKind.current = data.alarm.kind;
          announceAlarm(data.alarm);
        }
      } catch {
        return;
      }
    }
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session]);
  return <IngestAlarmContext.Provider value={alarm}>{props.children}</IngestAlarmContext.Provider>;
}

export function IngestAlarmBanner(): React.JSX.Element | null {
  const alarm = useIngestAlarm();
  if (alarm.kind === "ok") {
    return null;
  }
  const role = alarm.kind === "behind" ? "status" : "alert";
  let box = "border-warn/40 bg-warn/15 text-warn";
  if (alarm.kind === "poll_error" || alarm.kind === "tunnel_down") {
    box = "border-destructive/40 bg-destructive/15 text-destructive";
  }
  return (
    <div
      role={role}
      aria-atomic="true"
      className={`flex shrink-0 items-start gap-3 border-b px-4 py-2.5 ${box}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-semibold">{alarm.title}</p>
        <p className="text-xs opacity-90">{alarm.detail}</p>
      </div>
      <Link
        to="/settings#connections"
        className="shrink-0 text-xs font-medium underline underline-offset-4"
      >
        Connections
      </Link>
    </div>
  );
}
