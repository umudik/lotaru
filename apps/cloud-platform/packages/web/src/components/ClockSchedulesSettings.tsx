import { useEffect, useState } from "react";
import { Clock, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CalendarScheduleFields } from "@/components/CalendarScheduleFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSession } from "@/hooks/useSession";
import {
  createClockSchedule,
  deleteClockSchedule,
  fetchClockSchedules,
  patchClockSchedule,
  type ClockSchedule,
} from "@/lib/api";
import {
  calendarToCron,
  dailyCalendar,
  formatCalendarCron,
  type CalendarSchedule,
} from "@/lib/calendar-schedule";

function failureMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const text = err.message.trim();
    if (text.length > 0) {
      return text;
    }
  }
  return fallback;
}

export function ClockSchedulesSettings(): React.JSX.Element {
  const session = useSession();
  const [schedules, setSchedules] = useState<ClockSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [spec, setSpec] = useState<CalendarSchedule>(() => dailyCalendar(9, 0));
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");

  async function reload(): Promise<void> {
    if (session === null) {
      return;
    }
    const data = await fetchClockSchedules(session);
    setSchedules(data.schedules);
  }

  useEffect(() => {
    void (async () => {
      try {
        await reload();
      } catch (err) {
        toast.error(failureMessage(err, "Failed to load clock times"));
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  async function handleCreate(): Promise<void> {
    if (session === null) {
      return;
    }
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      toast.error("Give this time a name");
      return;
    }
    setSaving(true);
    try {
      await createClockSchedule(session, {
        title: trimmed,
        cron: calendarToCron(spec),
      });
      setTitle("");
      setSpec(dailyCalendar(9, 0));
      await reload();
      toast.success("Clock time added");
    } catch (err) {
      toast.error(failureMessage(err, "Failed to add clock time"));
    } finally {
      setSaving(false);
    }
  }

  async function handleEnabled(row: ClockSchedule, enabled: boolean): Promise<void> {
    if (session === null) {
      return;
    }
    setBusyId(row.id);
    try {
      await patchClockSchedule(session, row.id, { enabled });
      await reload();
    } catch (err) {
      toast.error(failureMessage(err, "Failed to update clock time"));
    } finally {
      setBusyId("");
    }
  }

  async function handleDelete(row: ClockSchedule): Promise<void> {
    if (session === null) {
      return;
    }
    if (row.builtin === true) {
      return;
    }
    setBusyId(row.id);
    try {
      await deleteClockSchedule(session, row.id);
      await reload();
      toast.success("Clock time removed");
    } catch (err) {
      toast.error(failureMessage(err, "Failed to remove clock time"));
    } finally {
      setBusyId("");
    }
  }

  return (
    <section id="clock" className="panel-card space-y-6 p-6">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
          <Clock className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-base font-semibold">Clock</h2>
          <p className="text-xs text-muted-foreground">
            Named times are events. Responders, scripts, and templates pick them the same way they
            pick GitHub or interval events. Add more below.
          </p>
        </div>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading clock times…</p>
      ) : (
        <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.08]">
          {schedules.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-3 py-2.5">
              <Switch
                checked={row.enabled}
                disabled={busyId === row.id}
                onCheckedChange={(checked) => {
                  void handleEnabled(row, checked);
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.title}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {row.eventType}
                  {" · "}
                  {formatCalendarCron(row.cron, 9, 0)}
                </p>
              </div>
              {row.builtin ? (
                <span className="shrink-0 text-[11px] text-muted-foreground">Built-in</span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={busyId === row.id}
                  onClick={() => {
                    void handleDelete(row);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-3 border-t border-border/60 pt-5">
        <h3 className="text-sm font-semibold">Add a time</h3>
        <div className="space-y-2">
          <Label htmlFor="clock-title">Name</Label>
          <Input
            id="clock-title"
            value={title}
            placeholder="Monday standup"
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        </div>
        <CalendarScheduleFields idPrefix="clock-new" spec={spec} onChange={setSpec} />
        <Button
          type="button"
          disabled={saving || title.trim().length === 0}
          onClick={() => {
            void handleCreate();
          }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </Button>
      </div>
    </section>
  );
}
