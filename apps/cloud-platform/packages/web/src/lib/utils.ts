import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export type PropBag = Record<string, string | number | boolean | null | object>;

export function omitProps(source: PropBag, keys: string[]): PropBag {
  const skip = new Set(keys);
  const result: PropBag = {};
  for (const key of Object.keys(source)) {
    if (!skip.has(key)) {
      const value = source[key];
      if (typeof value !== "undefined") {
        result[key] = value;
      }
    }
  }
  return result;
}

export function cn(
  a: ClassValue | null,
  b: ClassValue | null = null,
  c: ClassValue | null = null,
  d: ClassValue | null = null,
  e: ClassValue | null = null,
  f: ClassValue | null = null,
  g: ClassValue | null = null,
  h: ClassValue | null = null,
  i: ClassValue | null = null,
  j: ClassValue | null = null,
): string {
  const inputs: ClassValue[] = [];
  if (a !== null) inputs.push(a);
  if (b !== null) inputs.push(b);
  if (c !== null) inputs.push(c);
  if (d !== null) inputs.push(d);
  if (e !== null) inputs.push(e);
  if (f !== null) inputs.push(f);
  if (g !== null) inputs.push(g);
  if (h !== null) inputs.push(h);
  if (i !== null) inputs.push(i);
  if (j !== null) inputs.push(j);
  return twMerge(clsx(inputs));
}

export function formatWhen(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatDuration(ms: number | null) {
  if (ms === null || ms <= 0) return null;
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

export function formatMillis(ms: number): string {
  if (Number.isFinite(ms) !== true) {
    return "—";
  }
  if (ms <= 0) {
    return "—";
  }
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString();
}

export function formatAge(ms: number): string {
  if (Number.isFinite(ms) !== true) {
    return "—";
  }
  const deltaSec = Math.round((ms - Date.now()) / 1000);
  if (Number.isFinite(deltaSec) !== true) {
    return "—";
  }
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "always" });
  const absSec = Math.abs(deltaSec);
  if (absSec < 60) {
    return fmt.format(deltaSec, "second");
  }
  const deltaMin = Math.round(deltaSec / 60);
  if (Math.abs(deltaMin) < 60) {
    return fmt.format(deltaMin, "minute");
  }
  const deltaHour = Math.round(deltaMin / 60);
  if (Math.abs(deltaHour) < 24) {
    return fmt.format(deltaHour, "hour");
  }
  return fmt.format(Math.round(deltaHour / 24), "day");
}
