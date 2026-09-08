import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  CALENDAR_PERIODS,
  WEEKDAY_ORDER,
  calendarToggleWeekday,
  calendarWithPeriod,
  formatCalendarSchedule,
  hourChoices,
  minuteChoices,
  monthChoices,
  monthDayChoices,
  weekdayButtonLabel,
  type CalendarPeriod,
  type CalendarSchedule,
} from "@/lib/calendar-schedule";

type Props = {
  idPrefix: string;
  spec: CalendarSchedule;
  onChange(next: CalendarSchedule): void;
};

function isCalendarPeriod(value: string): value is CalendarPeriod {
  for (const period of CALENDAR_PERIODS) {
    if (period.id === value) {
      return true;
    }
  }
  return false;
}

export function CalendarScheduleFields(props: Props): React.JSX.Element {
  const summaryId = `${props.idPrefix}-summary`;
  const showHour = props.spec.period !== "hour";
  const showWeekdays = props.spec.period === "week";
  const showMonthDay = props.spec.period === "month" || props.spec.period === "year";
  const showMonth = props.spec.period === "year";
  const summary = formatCalendarSchedule(props.spec);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`${props.idPrefix}-period`}>Repeat</Label>
        <Select
          id={`${props.idPrefix}-period`}
          name={`${props.idPrefix}-period`}
          value={props.spec.period}
          aria-describedby={summaryId}
          onChange={(event) => {
            if (isCalendarPeriod(event.target.value)) {
              props.onChange(calendarWithPeriod(props.spec, event.target.value));
            }
          }}
        >
          {CALENDAR_PERIODS.map((period) => (
            <option key={period.id} value={period.id}>
              {period.label}
            </option>
          ))}
        </Select>
      </div>
      {showWeekdays ? (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium leading-none">Days</legend>
          <div className="flex flex-wrap gap-1">
            {WEEKDAY_ORDER.map((day) => {
              const selected = props.spec.weekdays.includes(day);
              const boxId = `${props.idPrefix}-dow-${String(day)}`;
              return (
                <label
                  key={day}
                  htmlFor={boxId}
                  className={cn(
                    "inline-flex h-10 min-w-10 cursor-pointer items-center justify-center rounded-xl border px-2 text-xs font-medium transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-white/[0.1] bg-[#111111] text-foreground hover:bg-white/[0.05]",
                  )}
                >
                  <input
                    id={boxId}
                    name={`${props.idPrefix}-dow`}
                    type="checkbox"
                    className="sr-only"
                    checked={selected}
                    onChange={() => {
                      props.onChange(calendarToggleWeekday(props.spec, day));
                    }}
                  />
                  {weekdayButtonLabel(day)}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      {showMonth ? (
        <div className="space-y-1">
          <Label htmlFor={`${props.idPrefix}-month`}>Month</Label>
          <Select
            id={`${props.idPrefix}-month`}
            name={`${props.idPrefix}-month`}
            value={String(props.spec.month)}
            onChange={(event) => {
              props.onChange(Object.assign({}, props.spec, { month: Number(event.target.value) }));
            }}
          >
            {monthChoices().map((month) => (
              <option key={month.id} value={month.id}>
                {month.label}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {showMonthDay ? (
        <div className="space-y-1">
          <Label htmlFor={`${props.idPrefix}-month-day`}>Day of month</Label>
          <Select
            id={`${props.idPrefix}-month-day`}
            name={`${props.idPrefix}-month-day`}
            value={String(props.spec.monthDay)}
            onChange={(event) => {
              props.onChange(Object.assign({}, props.spec, { monthDay: Number(event.target.value) }));
            }}
          >
            {monthDayChoices().map((day) => (
              <option key={day} value={day}>
                {String(day)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div className={cn("grid gap-2", showHour ? "grid-cols-2" : "grid-cols-1")}>
        {showHour ? (
          <div className="space-y-1">
            <Label htmlFor={`${props.idPrefix}-hour`}>Hour</Label>
            <Select
              id={`${props.idPrefix}-hour`}
              name={`${props.idPrefix}-hour`}
              value={String(props.spec.hour)}
              onChange={(event) => {
                props.onChange(Object.assign({}, props.spec, { hour: Number(event.target.value) }));
              }}
            >
              {hourChoices().map((hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, "0")}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor={`${props.idPrefix}-minute`}>Minute</Label>
          <Select
            id={`${props.idPrefix}-minute`}
            name={`${props.idPrefix}-minute`}
            value={String(props.spec.minute)}
            onChange={(event) => {
              props.onChange(Object.assign({}, props.spec, { minute: Number(event.target.value) }));
            }}
          >
            {minuteChoices().map((minute) => (
              <option key={minute} value={minute}>
                {String(minute).padStart(2, "0")}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p id={summaryId} className="text-xs text-muted-foreground">
        {summary}
      </p>
    </div>
  );
}
