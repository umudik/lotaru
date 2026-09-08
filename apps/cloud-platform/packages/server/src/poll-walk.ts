import { z } from "zod";

export const POLL_OVERLAP_MS = 120_000;
export const POLL_MAX_PAGES = 10;
export const POLL_PAGE_SIZE = 100;
export const POLL_MAX_WALK_PAGES = 40;
export const POLL_HEALTHY_MS = 30_000;
export const POLL_DRAIN_MS = 5_000;

export type PollWalkLimits = {
  maxPages: number;
  pageSize: number;
  maxWalkPages: number;
};

const drainPageSchema = z.string().regex(/^[0-9]+$/);

export function parseIsoMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isFinite(ms) !== true) {
    return 0;
  }
  return ms;
}

export function cutoffMsFrom(lastSuccessAt: number, nowMs: number, overlapMs: number): number {
  if (lastSuccessAt < 1) {
    const first = nowMs - overlapMs;
    if (first < 1) {
      return 1;
    }
    return first;
  }
  const cut = lastSuccessAt - overlapMs;
  if (cut < 1) {
    return 1;
  }
  return cut;
}

export function nextPollWatermark(input: {
  lastSuccessAt: number;
  nowMs: number;
  error: string;
  lagged: boolean;
}): number {
  if (input.error.length > 0) {
    return input.lastSuccessAt;
  }
  if (input.lagged !== true) {
    return input.nowMs;
  }
  if (input.lastSuccessAt < 1) {
    return input.nowMs;
  }
  return input.lastSuccessAt;
}

export function drainPageFromCursor(cursor: string): number {
  if (cursor.startsWith("page:") !== true) {
    return 1;
  }
  const raw = cursor.slice("page:".length);
  const parsed = drainPageSchema.safeParse(raw);
  if (parsed.success !== true) {
    return 1;
  }
  const page = Number.parseInt(parsed.data, 10);
  if (Number.isFinite(page) !== true || page < 1) {
    return 1;
  }
  return page;
}

export function drainCursorForPage(page: number): string {
  const n = page < 2 ? 1 : page;
  return `page:${String(n)}`;
}

export function nextPollDelayMs(polls: readonly { lagged: boolean; lastError: string }[]): number {
  let lagged = false;
  for (const row of polls) {
    if (row.lastError.length > 0) {
      return POLL_HEALTHY_MS;
    }
    if (row.lagged === true) {
      lagged = true;
    }
  }
  if (lagged === true) {
    return POLL_DRAIN_MS;
  }
  return POLL_HEALTHY_MS;
}

function walkPages(startPage: number, walkCap: number): number[] {
  const listed: number[] = [];
  if (startPage > 1) {
    listed.push(1);
  }
  let n = startPage < 1 ? 1 : startPage;
  while (listed.length < walkCap) {
    let already = false;
    for (const seen of listed) {
      if (seen === n) {
        already = true;
      }
    }
    if (already !== true) {
      listed.push(n);
    }
    n += 1;
  }
  return listed;
}

export async function fetchUntilCutoff<T>(input: {
  fetchPage: (page: number) => Promise<T[]>;
  updatedMs: (item: T) => number;
  cutoffMs: number;
  maxPages: number;
  pageSize: number;
  takeItem?: (item: T) => boolean;
  startPage?: number;
  maxWalkPages?: number;
}): Promise<{ items: T[]; lagged: boolean; pages: number; nextPage: number }> {
  const takeCap = input.maxPages * input.pageSize;
  let walkCap = input.maxWalkPages !== undefined ? input.maxWalkPages : POLL_MAX_WALK_PAGES;
  const startPage = input.startPage !== undefined && input.startPage > 1 ? input.startPage : 1;
  if (walkCap < 1) {
    walkCap = 1;
  }
  if (startPage > 1 && walkCap < 2) {
    walkCap = 2;
  }
  const collected: T[] = [];
  let drainPage = startPage;
  const sequence = walkPages(startPage, walkCap);
  for (const page of sequence) {
    const rows = await input.fetchPage(page);
    const headRefresh = startPage > 1 && page === 1;
    if (headRefresh !== true) {
      drainPage = page;
    }
    if (rows.length === 0) {
      return { items: collected, lagged: false, pages: page, nextPage: 1 };
    }
    let anyFresh = false;
    for (const row of rows) {
      const ms = input.updatedMs(row);
      if (ms < input.cutoffMs) {
        continue;
      }
      anyFresh = true;
      let take = true;
      if (input.takeItem !== undefined) {
        take = input.takeItem(row);
      }
      if (take !== true) {
        continue;
      }
      if (collected.length >= takeCap) {
        return { items: collected, lagged: true, pages: page, nextPage: drainPage };
      }
      collected.push(row);
    }
    if (anyFresh !== true) {
      return { items: collected, lagged: false, pages: page, nextPage: 1 };
    }
    if (rows.length < input.pageSize) {
      return { items: collected, lagged: false, pages: page, nextPage: 1 };
    }
    if (collected.length >= takeCap) {
      return { items: collected, lagged: true, pages: page, nextPage: drainPage + 1 };
    }
  }
  return { items: collected, lagged: true, pages: sequence.length, nextPage: drainPage + 1 };
}
