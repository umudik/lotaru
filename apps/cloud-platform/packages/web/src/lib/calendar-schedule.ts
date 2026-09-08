import { z } from "zod";

export const CALENDAR_PERIOD_IDS = ["hour", "day", "week", "month", "year"] as const;

export type CalendarPeriod = (typeof CALENDAR_PERIOD_IDS)[number];

export type CalendarSchedule = {
  period: CalendarPeriod;
  minute: number;
  hour: number;
  weekdays: readonly number[];
  monthDay: number;
  month: number;
};

export const CALENDAR_PERIODS: readonly { id: CalendarPeriod; label: string }[] = [
  { id: "hour", label: "Every hour" },
  { id: "day", label: "Every day" },
  { id: "week", label: "Selected weekdays" },
  { id: "month", label: "A day each month" },
  { id: "year", label: "A date each year" },
];

export const WEEKDAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

const WEEKDAY_NAMES: readonly string[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const WEEKDAY_SHORT: readonly string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTH_NAMES: readonly string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const periodSchema = z.enum(CALENDAR_PERIOD_IDS);
const weekdaySchema = z.number().int().min(0).max(6);

const calendarScheduleSchema = z.object({
  period: periodSchema,
  minute: z.number().int().min(0).max(59),
  hour: z.number().int().min(0).max(23),
  weekdays: z.array(weekdaySchema),
  monthDay: z.number().int().min(1).max(31),
  month: z.number().int().min(1).max(12),
});

const cronTokenSchema = z.string().regex(/^[0-9]+$/);

function invalidSchedule(): Error {
  return new Error("Invalid calendar schedule");
}

function parseCronInt(token: string, min: number, max: number): number {
  const parsed = cronTokenSchema.safeParse(token);
  if (parsed.success !== true) {
    throw invalidSchedule();
  }
  const amount = Number.parseInt(parsed.data, 10);
  if (Number.isInteger(amount) !== true) {
    throw invalidSchedule();
  }
  if (amount < min) {
    throw invalidSchedule();
  }
  if (amount > max) {
    throw invalidSchedule();
  }
  return amount;
}

function appendValue<T>(list: readonly T[], item: T): readonly T[] {
  const next = list.concat([item]);
  if (next.length !== list.length + 1) {
    throw invalidSchedule();
  }
  return next;
}

function uniqueSortedInts(values: readonly number[]): readonly number[] {
  const copy = values.slice();
  copy.sort((left: number, right: number) => left - right);
  let unique: readonly number[] = [];
  for (const amount of copy) {
    if (unique.includes(amount) === true) {
      continue;
    }
    unique = appendValue(unique, amount);
  }
  return unique;
}

function tokenAt(tokens: readonly string[], index: number): string {
  let cursor = 0;
  for (const token of tokens) {
    if (cursor === index) {
      return token;
    }
    cursor += 1;
  }
  throw invalidSchedule();
}

function parseCronList(field: string, min: number, max: number): readonly number[] {
  if (field.length === 0) {
    throw invalidSchedule();
  }
  const chunks = field.split(",");
  let values: readonly number[] = [];
  for (const chunk of chunks) {
    if (chunk.includes("/") === true) {
      throw invalidSchedule();
    }
    if (chunk.includes("-") === true) {
      const ends = chunk.split("-");
      if (ends.length !== 2) {
        throw invalidSchedule();
      }
      const start = parseCronInt(tokenAt(ends, 0), min, max);
      const stop = parseCronInt(tokenAt(ends, 1), min, max);
      if (start > stop) {
        throw invalidSchedule();
      }
      for (let amount = start; amount <= stop; amount += 1) {
        values = appendValue(values, amount);
      }
      continue;
    }
    values = appendValue(values, parseCronInt(chunk, min, max));
  }
  if (values.length === 0) {
    throw invalidSchedule();
  }
  return uniqueSortedInts(values);
}

function requireOne(values: readonly number[]): number {
  if (values.length !== 1) {
    throw invalidSchedule();
  }
  let found = -1;
  for (const amount of values) {
    found = amount;
  }
  if (found < 0) {
    throw invalidSchedule();
  }
  return found;
}

function normalizeWeekday(amount: number): number {
  if (amount === 7) {
    return 0;
  }
  if (amount < 0) {
    throw invalidSchedule();
  }
  if (amount > 6) {
    throw invalidSchedule();
  }
  return amount;
}

function parseDowList(field: string): readonly number[] {
  const raw = parseCronList(field, 0, 7);
  let mapped: readonly number[] = [];
  for (const amount of raw) {
    mapped = appendValue(mapped, normalizeWeekday(amount));
  }
  const unique = uniqueSortedInts(mapped);
  if (unique.length === 0) {
    throw invalidSchedule();
  }
  return unique;
}

function joinCronInts(values: readonly number[]): string {
  let text = "";
  for (const amount of values) {
    if (text.length === 0) {
      text = String(amount);
      continue;
    }
    text = `${text},${String(amount)}`;
  }
  if (text.length === 0) {
    throw invalidSchedule();
  }
  return text;
}

function parsedSchedule(input: CalendarSchedule): CalendarSchedule {
  const parsed = calendarScheduleSchema.safeParse(input);
  if (parsed.success !== true) {
    throw invalidSchedule();
  }
  const weekdays = uniqueSortedInts(parsed.data.weekdays);
  if (parsed.data.period === "week" && weekdays.length === 0) {
    throw invalidSchedule();
  }
  return {
    period: parsed.data.period,
    minute: parsed.data.minute,
    hour: parsed.data.hour,
    weekdays,
    monthDay: parsed.data.monthDay,
    month: parsed.data.month,
  };
}

export function dailyCalendar(hour: number, minute: number): CalendarSchedule {
  return parsedSchedule({
    period: "day",
    minute,
    hour,
    weekdays: [],
    monthDay: 1,
    month: 1,
  });
}

export function calendarToCron(input: CalendarSchedule): string {
  const spec = parsedSchedule(input);
  if (spec.period === "hour") {
    return `${String(spec.minute)} * * * *`;
  }
  if (spec.period === "day") {
    return `${String(spec.minute)} ${String(spec.hour)} * * *`;
  }
  if (spec.period === "week") {
    return `${String(spec.minute)} ${String(spec.hour)} * * ${joinCronInts(spec.weekdays)}`;
  }
  if (spec.period === "month") {
    return `${String(spec.minute)} ${String(spec.hour)} ${String(spec.monthDay)} * *`;
  }
  return `${String(spec.minute)} ${String(spec.hour)} ${String(spec.monthDay)} ${String(spec.month)} *`;
}

export function parseCalendarCron(expression: string): CalendarSchedule {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    throw invalidSchedule();
  }
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    throw invalidSchedule();
  }
  const minuteField = tokenAt(fields, 0);
  const hourField = tokenAt(fields, 1);
  const dayField = tokenAt(fields, 2);
  const monthField = tokenAt(fields, 3);
  const dowField = tokenAt(fields, 4);
  if (minuteField === "*") {
    throw invalidSchedule();
  }
  const minute = requireOne(parseCronList(minuteField, 0, 59));
  const hourAny = hourField === "*";
  const dayAny = dayField === "*";
  const monthAny = monthField === "*";
  const dowAny = dowField === "*";
  let hour = 0;
  if (hourAny !== true) {
    hour = requireOne(parseCronList(hourField, 0, 23));
  }
  let monthDay = 1;
  if (dayAny !== true) {
    monthDay = requireOne(parseCronList(dayField, 1, 31));
  }
  let month = 1;
  if (monthAny !== true) {
    month = requireOne(parseCronList(monthField, 1, 12));
  }
  let weekdays: readonly number[] = [];
  if (dowAny !== true) {
    weekdays = parseDowList(dowField);
  }
  if (hourAny === true && dayAny === true && monthAny === true && dowAny === true) {
    return parsedSchedule({
      period: "hour",
      minute,
      hour: 0,
      weekdays: [],
      monthDay: 1,
      month: 1,
    });
  }
  if (hourAny !== true && dayAny === true && monthAny === true && dowAny === true) {
    return parsedSchedule({
      period: "day",
      minute,
      hour,
      weekdays: [],
      monthDay: 1,
      month: 1,
    });
  }
  if (hourAny !== true && dayAny === true && monthAny === true && dowAny !== true) {
    return parsedSchedule({
      period: "week",
      minute,
      hour,
      weekdays,
      monthDay: 1,
      month: 1,
    });
  }
  if (hourAny !== true && dayAny !== true && monthAny === true && dowAny === true) {
    return parsedSchedule({
      period: "month",
      minute,
      hour,
      weekdays: [],
      monthDay,
      month: 1,
    });
  }
  if (hourAny !== true && dayAny !== true && monthAny !== true && dowAny === true) {
    return parsedSchedule({
      period: "year",
      minute,
      hour,
      weekdays: [],
      monthDay,
      month,
    });
  }
  throw invalidSchedule();
}

export function calendarFromParts(cron: string, hour: number, minute: number): CalendarSchedule {
  const trimmed = cron.trim();
  if (trimmed.length > 0) {
    return parseCalendarCron(trimmed);
  }
  return dailyCalendar(hour, minute);
}

export function tryCalendarFromParts(cron: string, hour: number, minute: number): CalendarSchedule {
  try {
    return calendarFromParts(cron, hour, minute);
  } catch {
    return dailyCalendar(hour, minute);
  }
}

function calendarDateMatches(spec: CalendarSchedule, now: Date): boolean {
  if (spec.period === "hour") {
    return true;
  }
  if (spec.period === "day") {
    return true;
  }
  if (spec.period === "week") {
    return spec.weekdays.includes(now.getDay());
  }
  if (spec.period === "month") {
    return now.getDate() === spec.monthDay;
  }
  if (now.getMonth() + 1 !== spec.month) {
    return false;
  }
  return now.getDate() === spec.monthDay;
}

function timeReached(spec: CalendarSchedule, now: Date): boolean {
  const hour = now.getHours();
  const minute = now.getMinutes();
  if (hour > spec.hour) {
    return true;
  }
  if (hour < spec.hour) {
    return false;
  }
  return minute >= spec.minute;
}

export function calendarHitsNow(spec: CalendarSchedule, now: Date): boolean {
  const checked = parsedSchedule(spec);
  if (now.getMinutes() !== checked.minute) {
    return false;
  }
  if (checked.period === "hour") {
    return true;
  }
  if (now.getHours() !== checked.hour) {
    return false;
  }
  return calendarDateMatches(checked, now);
}

export function calendarDueToday(spec: CalendarSchedule, now: Date): boolean {
  const checked = parsedSchedule(spec);
  if (checked.period === "hour") {
    return now.getMinutes() === checked.minute;
  }
  if (calendarDateMatches(checked, now) !== true) {
    return false;
  }
  return timeReached(checked, now);
}

export function calendarClaimStamp(spec: CalendarSchedule, now: Date): string {
  const checked = parsedSchedule(spec);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const ymd = `${String(year)}-${month}-${day}`;
  if (checked.period === "hour") {
    const hour = String(now.getHours()).padStart(2, "0");
    return `${ymd}T${hour}`;
  }
  return ymd;
}

export function calendarWithPeriod(spec: CalendarSchedule, period: CalendarPeriod): CalendarSchedule {
  const checked = parsedSchedule(spec);
  const periodParsed = periodSchema.safeParse(period);
  if (periodParsed.success !== true) {
    throw invalidSchedule();
  }
  let weekdays = checked.weekdays;
  if (periodParsed.data === "week" && weekdays.length === 0) {
    weekdays = [1];
  }
  return parsedSchedule({
    period: periodParsed.data,
    minute: checked.minute,
    hour: checked.hour,
    weekdays,
    monthDay: checked.monthDay,
    month: checked.month,
  });
}

export function calendarToggleWeekday(spec: CalendarSchedule, weekday: number): CalendarSchedule {
  const checked = parsedSchedule(spec);
  const day = weekdaySchema.safeParse(weekday);
  if (day.success !== true) {
    throw invalidSchedule();
  }
  let next: readonly number[] = [];
  let removed = false;
  for (const existing of checked.weekdays) {
    if (existing === day.data) {
      removed = true;
      continue;
    }
    next = appendValue(next, existing);
  }
  if (removed !== true) {
    next = appendValue(next, day.data);
  }
  if (next.length === 0) {
    return checked;
  }
  return parsedSchedule({
    period: "week",
    minute: checked.minute,
    hour: checked.hour,
    weekdays: next,
    monthDay: checked.monthDay,
    month: checked.month,
  });
}

function weekdayLabel(day: number, plural: boolean): string {
  const name = WEEKDAY_NAMES[day];
  if (name === undefined) {
    throw invalidSchedule();
  }
  if (plural !== true) {
    return name;
  }
  return `${name}s`;
}

function weekdayShort(day: number): string {
  const name = WEEKDAY_SHORT[day];
  if (name === undefined) {
    throw invalidSchedule();
  }
  return name;
}

function monthName(month: number): string {
  const name = MONTH_NAMES[month - 1];
  if (name === undefined) {
    throw invalidSchedule();
  }
  return name;
}

function monthDayLabel(day: number): string {
  const modHundred = day % 100;
  if (modHundred >= 11 && modHundred <= 13) {
    return `${String(day)}th`;
  }
  const modTen = day % 10;
  if (modTen === 1) {
    return `${String(day)}st`;
  }
  if (modTen === 2) {
    return `${String(day)}nd`;
  }
  if (modTen === 3) {
    return `${String(day)}rd`;
  }
  return `${String(day)}th`;
}

function clockLabel(hour: number, minute: number): string {
  const hourText = String(hour).padStart(2, "0");
  const minuteText = String(minute).padStart(2, "0");
  return `${hourText}:${minuteText}`;
}

function weekdaysDisplay(days: readonly number[]): readonly number[] {
  let listed: readonly number[] = [];
  for (const day of WEEKDAY_ORDER) {
    if (days.includes(day) !== true) {
      continue;
    }
    listed = appendValue(listed, day);
  }
  return listed;
}

function weekdaySummary(days: readonly number[]): string {
  const listed = weekdaysDisplay(days);
  if (listed.length === 1) {
    let only = 0;
    for (const day of listed) {
      only = day;
    }
    return weekdayLabel(only, true);
  }
  let text = "";
  for (const day of listed) {
    const name = weekdayLabel(day, false);
    if (text.length === 0) {
      text = name;
      continue;
    }
    text = `${text}, ${name}`;
  }
  if (text.length === 0) {
    throw invalidSchedule();
  }
  return text;
}

export function weekdayButtonLabel(day: number): string {
  return weekdayShort(day);
}

export function formatCalendarSchedule(input: CalendarSchedule): string {
  const spec = parsedSchedule(input);
  const clock = clockLabel(spec.hour, spec.minute);
  if (spec.period === "hour") {
    const minuteText = String(spec.minute).padStart(2, "0");
    return `Every hour at :${minuteText}`;
  }
  if (spec.period === "day") {
    return `Every day at ${clock}`;
  }
  if (spec.period === "week") {
    return `${weekdaySummary(spec.weekdays)} at ${clock}`;
  }
  if (spec.period === "month") {
    return `On the ${monthDayLabel(spec.monthDay)} at ${clock}`;
  }
  return `${String(spec.monthDay)} ${monthName(spec.month)} at ${clock}`;
}

export function formatCalendarCron(cron: string, hour: number, minute: number): string {
  const spec = tryCalendarFromParts(cron, hour, minute);
  return formatCalendarSchedule(spec);
}

export function hourChoices(): readonly number[] {
  let hours: readonly number[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    hours = appendValue(hours, hour);
  }
  return hours;
}

export function minuteChoices(): readonly number[] {
  let minutes: readonly number[] = [];
  for (let minute = 0; minute < 60; minute += 1) {
    minutes = appendValue(minutes, minute);
  }
  return minutes;
}

export function monthDayChoices(): readonly number[] {
  let days: readonly number[] = [];
  for (let day = 1; day <= 31; day += 1) {
    days = appendValue(days, day);
  }
  return days;
}

export function monthChoices(): readonly { id: number; label: string }[] {
  let months: readonly { id: number; label: string }[] = [];
  for (let month = 1; month <= 12; month += 1) {
    months = appendValue(months, { id: month, label: monthName(month) });
  }
  return months;
}
