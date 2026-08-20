import Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { userCanAccessProject } from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { loadAppSettings, openSettingsDb, type AppSettings } from "../app-settings.js";
import { titleFromBody } from "../note-language.js";
import {
  nextRetryDelayMs,
  OLLAMA_MODEL_REQUIRED,
  ollamaJobRetryKey,
  polishText,
  shouldRetryOllama,
  summarizeText,
  translateText,
} from "../ollama.js";
import { synthesizeSpeech } from "../tts.js";
import type { Identity } from "./identity.js";

export type JobStatus = "none" | "pending" | "ready" | "error";
export type SpeakVariant = "original" | "translated" | "polished" | "summary";

type NoteBook = {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  createdBy: string;
  translateOn: boolean;
  polishOn: boolean;
  summarizeOn: boolean;
};

export type NotePage = {
  id: string;
  bookId: string;
  title: string;
  body: string;
  position: number;
  createdAt: string;
  translatedBody: string;
  translationStatus: JobStatus;
  translationError: string;
  polishedBody: string;
  polishStatus: JobStatus;
  polishError: string;
  summaryBody: string;
  summaryStatus: JobStatus;
  summaryError: string;
};

type BookRow = {
  id: string;
  project_id: string;
  title: string;
  created_at: string;
  created_by: string;
  translate_on: number;
  polish_on: number;
  summarize_on: number;
};

type PageRow = {
  id: string;
  book_id: string;
  title: string;
  body: string;
  position: number;
  created_at: string;
  translated_body: string;
  translation_status: string;
  translation_error?: string;
  polished_body: string;
  polish_status: string;
  polish_error?: string;
  summary_body: string;
  summary_status: string;
  summary_error?: string;
};

type Viewer = { email: string; sub: string };

type NotesOptions = {
  databasePath: string;
  identity: Identity;
  projectAccess?: (projectId: string, userId: string) => boolean;
};

type ProcessKind = "translate" | "polish" | "summary";

const createBookSchema = z.object({
  projectId: z.string().trim().min(1),
  title: z.string().trim(),
});

const patchBookSchema = z.object({
  title: z.string().trim().min(1).optional(),
  translateOn: z.boolean().optional(),
  polishOn: z.boolean().optional(),
  summarizeOn: z.boolean().optional(),
});

const createPageSchema = z.object({
  body: z.string().trim().min(1),
  title: z.string().trim().optional(),
});

const patchPageSchema = z.object({
  title: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1).optional(),
});

const speakSchema = z.object({
  variant: z.enum(["original", "translated", "polished", "summary"]),
});

const retrySchema = z.object({
  variant: z.enum(["translate", "polish", "summary"]),
});

function isJobStatus(value: string): value is JobStatus {
  return value === "none" || value === "pending" || value === "ready" || value === "error";
}

function statusFrom(value: string): JobStatus {
  if (isJobStatus(value)) {
    return value;
  }
  return "none";
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { name: string } | undefined;
  return row !== undefined;
}

export function openNotesDb(databasePath: string): Database.Database {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_books (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      translate_on INTEGER NOT NULL DEFAULT 1,
      polish_on INTEGER NOT NULL DEFAULT 1,
      summarize_on INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_note_books_project ON note_books(project_id);
    CREATE TABLE IF NOT EXISTS note_pages (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      translated_body TEXT NOT NULL DEFAULT '',
      translation_status TEXT NOT NULL DEFAULT 'none',
      translation_error TEXT NOT NULL DEFAULT '',
      polished_body TEXT NOT NULL DEFAULT '',
      polish_status TEXT NOT NULL DEFAULT 'none',
      polish_error TEXT NOT NULL DEFAULT '',
      summary_body TEXT NOT NULL DEFAULT '',
      summary_status TEXT NOT NULL DEFAULT 'none',
      summary_error TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (book_id) REFERENCES note_books(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_note_pages_book ON note_pages(book_id, position);
  `);
  migrateLegacyNotes(db);
  migrateJobSwitchesDefaultOn(db);
  migrateJobErrorColumns(db);
  return db;
}

const pragmaColumnSchema = z.object({
  name: z.string(),
});

function tableHasColumn(db: Database.Database, table: string, column: string): boolean {
  const raw = db.pragma(`table_info(${table})`);
  if (Array.isArray(raw) !== true) {
    return false;
  }
  for (const entry of raw) {
    const parsed = pragmaColumnSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    if (parsed.data.name === column) {
      return true;
    }
  }
  return false;
}

function migrateJobErrorColumns(db: Database.Database): void {
  if (tableHasColumn(db, "note_pages", "translation_error") !== true) {
    db.exec("ALTER TABLE note_pages ADD COLUMN translation_error TEXT NOT NULL DEFAULT ''");
  }
  if (tableHasColumn(db, "note_pages", "polish_error") !== true) {
    db.exec("ALTER TABLE note_pages ADD COLUMN polish_error TEXT NOT NULL DEFAULT ''");
  }
  if (tableHasColumn(db, "note_pages", "summary_error") !== true) {
    db.exec("ALTER TABLE note_pages ADD COLUMN summary_error TEXT NOT NULL DEFAULT ''");
  }
}

function caughtError(failure: unknown): Error {
  if (failure instanceof Error) {
    return failure;
  }
  return new Error("Ollama did not finish");
}

function jobErrorMessage(failure: Error): string {
  const text = failure.message.trim();
  if (text.length === 0) {
    return "Ollama did not finish";
  }
  if (text.length > 400) {
    return text.slice(0, 400);
  }
  return text;
}


function migrateJobSwitchesDefaultOn(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_migrations (
      id TEXT PRIMARY KEY
    );
  `);
  const applied = db.prepare("SELECT id FROM note_migrations WHERE id = ?").get("jobs_default_on") as
    | { id: string }
    | undefined;
  if (applied !== undefined) {
    return;
  }
  db.prepare(
    "UPDATE note_books SET translate_on = 1, polish_on = 1, summarize_on = 1 WHERE translate_on = 0 AND polish_on = 0 AND summarize_on = 0",
  ).run();
  db.prepare("INSERT INTO note_migrations (id) VALUES (?)").run("jobs_default_on");
}

function migrateLegacyNotes(db: Database.Database): void {
  if (tableExists(db, "notes") !== true) {
    return;
  }
  const pageCount = db.prepare("SELECT COUNT(*) AS c FROM note_pages").get() as { c: number };
  if (pageCount.c > 0) {
    return;
  }
  const legacy = db.prepare("SELECT * FROM notes ORDER BY created_at ASC").all() as {
    id: string;
    title: string;
    body: string;
    translated_body?: string;
    translation_status?: string;
    created_at: string;
    created_by: string;
    project_id: string;
  }[];
  if (legacy.length === 0) {
    return;
  }
  const books = new Map<string, { id: string; position: number }>();
  for (const row of legacy) {
    let book = books.get(row.project_id);
    if (book === undefined) {
      const id = randomUUID();
      db.prepare(
        "INSERT INTO note_books (id, project_id, title, created_at, created_by, translate_on, polish_on, summarize_on) VALUES (?, ?, ?, ?, ?, 1, 1, 1)",
      ).run(id, row.project_id, "Inbox", row.created_at, row.created_by);
      book = { id, position: 0 };
      books.set(row.project_id, book);
    }
    book.position += 1;
    let translatedBody = "";
    if (typeof row.translated_body === "string") {
      translatedBody = row.translated_body;
    }
    let translationStatus = "none";
    if (typeof row.translation_status === "string") {
      translationStatus = row.translation_status;
    }
    db.prepare(
      "INSERT INTO note_pages (id, book_id, title, body, position, created_at, translated_body, translation_status, polished_body, polish_status, summary_body, summary_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 'none', '', 'none')",
    ).run(
      row.id,
      book.id,
      row.title,
      row.body,
      book.position,
      row.created_at,
      translatedBody,
      statusFrom(translationStatus),
    );
  }
}

function rowToBook(row: BookRow): NoteBook {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    createdAt: row.created_at,
    createdBy: row.created_by,
    translateOn: row.translate_on === 1,
    polishOn: row.polish_on === 1,
    summarizeOn: row.summarize_on === 1,
  };
}

function optionalCell(value: string | undefined): string {
  if (value === undefined) {
    return "";
  }
  return value;
}

function rowToPage(row: PageRow): NotePage {
  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    body: row.body,
    position: row.position,
    createdAt: row.created_at,
    translatedBody: row.translated_body,
    translationStatus: statusFrom(row.translation_status),
    translationError: optionalCell(row.translation_error),
    polishedBody: row.polished_body,
    polishStatus: statusFrom(row.polish_status),
    polishError: optionalCell(row.polish_error),
    summaryBody: row.summary_body,
    summaryStatus: statusFrom(row.summary_status),
    summaryError: optionalCell(row.summary_error),
  };
}

function canSeeProject(options: NotesOptions, projectId: string, userId: string): boolean {
  if (options.projectAccess !== undefined) {
    return options.projectAccess(projectId, userId);
  }
  return userCanAccessProject(projectId, userId);
}

async function viewerFrom(request: FastifyRequest, options: NotesOptions): Promise<Viewer | null> {
  const user = await options.identity.userFrom(request);
  if (user === null) {
    return null;
  }
  return { email: user.email, sub: user.id };
}

function getBook(db: Database.Database, id: string): NoteBook | null {
  const row = db.prepare("SELECT * FROM note_books WHERE id = ?").get(id) as BookRow | undefined;
  if (row === undefined) {
    return null;
  }
  return rowToBook(row);
}

function getPage(db: Database.Database, id: string): NotePage | null {
  const row = db.prepare("SELECT * FROM note_pages WHERE id = ?").get(id) as PageRow | undefined;
  if (row === undefined) {
    return null;
  }
  return rowToPage(row);
}

function listPages(db: Database.Database, bookId: string): NotePage[] {
  const rows = db
    .prepare("SELECT * FROM note_pages WHERE book_id = ? ORDER BY position ASC, created_at ASC")
    .all(bookId) as PageRow[];
  const pages: NotePage[] = [];
  for (const row of rows) {
    pages.push(rowToPage(row));
  }
  return pages;
}

function nextPosition(db: Database.Database, bookId: string): number {
  const row = db
    .prepare("SELECT MAX(position) AS max_position FROM note_pages WHERE book_id = ?")
    .get(bookId) as { max_position: number | null };
  if (row.max_position === null) {
    return 1;
  }
  return row.max_position + 1;
}

function bookPayload(db: Database.Database, book: NoteBook): NoteBook & { pages: NotePage[] } {
  return Object.assign({}, book, { pages: listPages(db, book.id) });
}

function needsJob(status: JobStatus): boolean {
  return status === "none" || status === "error";
}

export async function registerNotesModule(app: FastifyInstance, options: NotesOptions): Promise<void> {
  const db = openNotesDb(options.databasePath);
  const settingsDb = openSettingsDb(options.databasePath);
  const jobQueue: { kind: ProcessKind; pageId: string }[] = [];
  const retryAttempts = new Map<string, number>();
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let draining = false;

  function clearJobRetry(kind: ProcessKind, pageId: string): void {
    const key = ollamaJobRetryKey(kind, pageId);
    retryAttempts.delete(key);
    const timer = retryTimers.get(key);
    if (timer === undefined) {
      return;
    }
    clearTimeout(timer);
    retryTimers.delete(key);
  }

  function markJobFailed(kind: ProcessKind, pageId: string, message: string): void {
    clearJobRetry(kind, pageId);
    if (kind === "translate") {
      db.prepare("UPDATE note_pages SET translation_status = 'error', translation_error = ? WHERE id = ?").run(
        message,
        pageId,
      );
      return;
    }
    if (kind === "polish") {
      db.prepare("UPDATE note_pages SET polish_status = 'error', polish_error = ? WHERE id = ?").run(message, pageId);
      return;
    }
    db.prepare("UPDATE note_pages SET summary_status = 'error', summary_error = ? WHERE id = ?").run(message, pageId);
  }

  function scheduleJobRetry(kind: ProcessKind, pageId: string): void {
    const key = ollamaJobRetryKey(kind, pageId);
    const previous = retryAttempts.get(key);
    let attempt = 1;
    if (previous !== undefined) {
      attempt = previous + 1;
    }
    retryAttempts.set(key, attempt);
    const existing = retryTimers.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const delayMs = nextRetryDelayMs(attempt);
    const timer = setTimeout(() => {
      retryTimers.delete(key);
      const page = getPage(db, pageId);
      if (page === null) {
        clearJobRetry(kind, pageId);
        return;
      }
      markPending(kind, pageId);
      enqueue(kind, pageId);
    }, delayMs);
    retryTimers.set(key, timer);
  }

  async function runJob(kind: ProcessKind, pageId: string): Promise<void> {
    const page = getPage(db, pageId);
    if (page === null) {
      clearJobRetry(kind, pageId);
      return;
    }
    const settings = loadAppSettings(settingsDb);
    try {
      if (kind === "translate") {
        const translated = await translateText(
          settings.ollamaHost,
          settings.ollamaModel,
          settings.targetLanguage,
          page.body,
        );
        db.prepare(
          "UPDATE note_pages SET translated_body = ?, translation_status = 'ready', translation_error = '' WHERE id = ?",
        ).run(translated, page.id);
        clearJobRetry(kind, pageId);
        return;
      }
      if (kind === "polish") {
        const polished = await polishText(settings.ollamaHost, settings.ollamaModel, page.body);
        db.prepare(
          "UPDATE note_pages SET polished_body = ?, polish_status = 'ready', polish_error = '' WHERE id = ?",
        ).run(polished, page.id);
        clearJobRetry(kind, pageId);
        return;
      }
      const summary = await summarizeText(settings.ollamaHost, settings.ollamaModel, page.body);
      db.prepare(
        "UPDATE note_pages SET summary_body = ?, summary_status = 'ready', summary_error = '' WHERE id = ?",
      ).run(summary, page.id);
      clearJobRetry(kind, pageId);
    } catch (failure) {
      const message = jobErrorMessage(caughtError(failure));
      if (shouldRetryOllama(message)) {
        scheduleJobRetry(kind, pageId);
        return;
      }
      markJobFailed(kind, pageId, message);
    }
  }

  async function drainJobs(): Promise<void> {
    if (draining) {
      return;
    }
    draining = true;
    while (jobQueue.length > 0) {
      const next = jobQueue.shift();
      if (next === undefined) {
        continue;
      }
      await runJob(next.kind, next.pageId);
    }
    draining = false;
  }

  function enqueue(kind: ProcessKind, pageId: string): void {
    for (const item of jobQueue) {
      if (item.kind === kind && item.pageId === pageId) {
        void drainJobs();
        return;
      }
    }
    jobQueue.push({ kind, pageId });
    void drainJobs();
  }

  function markPending(kind: ProcessKind, pageId: string): void {
    if (kind === "translate") {
      db.prepare("UPDATE note_pages SET translation_status = 'pending', translation_error = '' WHERE id = ?").run(
        pageId,
      );
      return;
    }
    if (kind === "polish") {
      db.prepare("UPDATE note_pages SET polish_status = 'pending', polish_error = '' WHERE id = ?").run(pageId);
      return;
    }
    db.prepare("UPDATE note_pages SET summary_status = 'pending', summary_error = '' WHERE id = ?").run(pageId);
  }

  function queuePageJobs(page: NotePage, book: NoteBook, force: ProcessKind | false): void {
    const settings = loadAppSettings(settingsDb);
    const wantTranslate =
      force === "translate" || (force === false && book.translateOn && needsJob(page.translationStatus));
    const wantPolish =
      force === "polish" || (force === false && book.polishOn && needsJob(page.polishStatus));
    const wantSummary =
      force === "summary" || (force === false && book.summarizeOn && needsJob(page.summaryStatus));
    if (settings.ollamaModel.trim().length === 0) {
      if (wantTranslate) {
        db.prepare("UPDATE note_pages SET translation_status = 'error', translation_error = ? WHERE id = ?").run(
          OLLAMA_MODEL_REQUIRED,
          page.id,
        );
      }
      if (wantPolish) {
        db.prepare("UPDATE note_pages SET polish_status = 'error', polish_error = ? WHERE id = ?").run(
          OLLAMA_MODEL_REQUIRED,
          page.id,
        );
      }
      if (wantSummary) {
        db.prepare("UPDATE note_pages SET summary_status = 'error', summary_error = ? WHERE id = ?").run(
          OLLAMA_MODEL_REQUIRED,
          page.id,
        );
      }
      return;
    }
    if (wantTranslate) {
      markPending("translate", page.id);
      enqueue("translate", page.id);
    }
    if (wantPolish) {
      markPending("polish", page.id);
      enqueue("polish", page.id);
    }
    if (wantSummary) {
      markPending("summary", page.id);
      enqueue("summary", page.id);
    }
  }

  function queueBookJobs(book: NoteBook, force: ProcessKind | false): void {
    const pages = listPages(db, book.id);
    for (const page of pages) {
      queuePageJobs(page, book, force);
    }
  }

  app.get<{ Querystring: { projectId?: string } }>("/api/note-books", async (request, reply) => {
    const viewer = await viewerFrom(request, options);
    if (!viewer) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const projectId = String(request.query.projectId ?? "").trim();
    if (projectId.length === 0) {
      return reply.code(400).send({ error: "projectId required" });
    }
    if (!canSeeProject(options, projectId, viewer.sub)) {
      return reply.code(404).send({ error: "not found" });
    }
    const rows = db
      .prepare("SELECT * FROM note_books WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as BookRow[];
    const books: Array<NoteBook & { pageCount: number }> = [];
    for (const row of rows) {
      const book = rowToBook(row);
      const count = db.prepare("SELECT COUNT(*) AS c FROM note_pages WHERE book_id = ?").get(book.id) as {
        c: number;
      };
      books.push(Object.assign({}, book, { pageCount: count.c }));
    }
    return { books };
  });

  app.post("/api/note-books", async (request, reply) => {
    const viewer = await viewerFrom(request, options);
    if (!viewer) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = createBookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid book" });
    }
    if (!canSeeProject(options, parsed.data.projectId, viewer.sub)) {
      return reply.code(404).send({ error: "not found" });
    }
    let title = parsed.data.title;
    if (title.length === 0) {
      title = "Untitled book";
    }
    const book: NoteBook = {
      id: randomUUID(),
      projectId: parsed.data.projectId,
      title: title.slice(0, 200),
      createdAt: new Date().toISOString(),
      createdBy: viewer.email,
      translateOn: true,
      polishOn: true,
      summarizeOn: true,
    };
    db.prepare(
      "INSERT INTO note_books (id, project_id, title, created_at, created_by, translate_on, polish_on, summarize_on) VALUES (?, ?, ?, ?, ?, 1, 1, 1)",
    ).run(book.id, book.projectId, book.title, book.createdAt, book.createdBy);
    return reply.code(201).send(bookPayload(db, book));
  });

  app.get<{ Params: { bookId: string } }>("/api/note-books/:bookId", async (request, reply) => {
    const viewer = await viewerFrom(request, options);
    if (!viewer) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const book = getBook(db, request.params.bookId);
    if (book === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (!canSeeProject(options, book.projectId, viewer.sub)) {
      return reply.code(404).send({ error: "not found" });
    }
    return bookPayload(db, book);
  });

  app.patch<{ Params: { bookId: string } }>("/api/note-books/:bookId", async (request, reply) => {
    const viewer = await viewerFrom(request, options);
    if (!viewer) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const book = getBook(db, request.params.bookId);
    if (book === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (!canSeeProject(options, book.projectId, viewer.sub)) {
      return reply.code(404).send({ error: "not found" });
    }
    const parsed = patchBookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid book" });
    }
    let title = book.title;
    if (parsed.data.title !== undefined) {
      title = parsed.data.title.slice(0, 200);
    }
    let translateOn = book.translateOn;
    if (parsed.data.translateOn !== undefined) {
      translateOn = parsed.data.translateOn;
    }
    let polishOn = book.polishOn;
    if (parsed.data.polishOn !== undefined) {
      polishOn = parsed.data.polishOn;
    }
    let summarizeOn = book.summarizeOn;
    if (parsed.data.summarizeOn !== undefined) {
      summarizeOn = parsed.data.summarizeOn;
    }
    db.prepare(
      "UPDATE note_books SET title = ?, translate_on = ?, polish_on = ?, summarize_on = ? WHERE id = ?",
    ).run(title, translateOn ? 1 : 0, polishOn ? 1 : 0, summarizeOn ? 1 : 0, book.id);
    const next = getBook(db, book.id);
    if (next === null) {
      return reply.code(404).send({ error: "not found" });
    }
    queueBookJobs(next, false);
    return bookPayload(db, next);
  });

  app.delete<{ Params: { bookId: string } }>("/api/note-books/:bookId", async (request, reply) => {
    const viewer = await viewerFrom(request, options);
    if (!viewer) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const book = getBook(db, request.params.bookId);
    if (book === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (!canSeeProject(options, book.projectId, viewer.sub)) {
      return reply.code(404).send({ error: "not found" });
    }
    db.prepare("DELETE FROM note_books WHERE id = ?").run(book.id);
    return { ok: true };
  });

  app.post<{ Params: { bookId: string } }>("/api/note-books/:bookId/pages", async (request, reply) => {
    const viewer = await viewerFrom(request, options);
    if (!viewer) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const book = getBook(db, request.params.bookId);
    if (book === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (!canSeeProject(options, book.projectId, viewer.sub)) {
      return reply.code(404).send({ error: "not found" });
    }
    const parsed = createPageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "body required" });
    }
    const body = parsed.data.body.slice(0, 200_000);
    let title = "";
    if (parsed.data.title !== undefined && parsed.data.title.length > 0) {
      title = parsed.data.title;
    } else {
      title = titleFromBody(body);
    }
    const page: NotePage = {
      id: randomUUID(),
      bookId: book.id,
      title: title.slice(0, 200),
      body,
      position: nextPosition(db, book.id),
      createdAt: new Date().toISOString(),
      translatedBody: "",
      translationStatus: "none",
      translationError: "",
      polishedBody: "",
      polishStatus: "none",
      polishError: "",
      summaryBody: "",
      summaryStatus: "none",
      summaryError: "",
    };
    db.prepare(
      "INSERT INTO note_pages (id, book_id, title, body, position, created_at, translated_body, translation_status, polished_body, polish_status, summary_body, summary_status) VALUES (?, ?, ?, ?, ?, ?, '', 'none', '', 'none', '', 'none')",
    ).run(page.id, page.bookId, page.title, page.body, page.position, page.createdAt);
    queuePageJobs(page, book, false);
    const stored = getPage(db, page.id);
    if (stored === null) {
      return reply.code(500).send({ error: "page missing" });
    }
    return reply.code(201).send(stored);
  });

  app.patch<{ Params: { pageId: string } }>("/api/note-pages/:pageId", async (request, reply) => {
    const viewer = await viewerFrom(request, options);
    if (!viewer) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const page = getPage(db, request.params.pageId);
    if (page === null) {
      return reply.code(404).send({ error: "not found" });
    }
    const book = getBook(db, page.bookId);
    if (book === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (!canSeeProject(options, book.projectId, viewer.sub)) {
      return reply.code(404).send({ error: "not found" });
    }
    const parsed = patchPageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid page" });
    }
    let title = page.title;
    if (parsed.data.title !== undefined) {
      title = parsed.data.title.slice(0, 200);
    }
    let body = page.body;
    let bodyChanged = false;
    if (parsed.data.body !== undefined) {
      body = parsed.data.body.slice(0, 200_000);
      bodyChanged = body !== page.body;
    }
    if (bodyChanged) {
      db.prepare(
        "UPDATE note_pages SET title = ?, body = ?, translated_body = '', translation_status = 'none', translation_error = '', polished_body = '', polish_status = 'none', polish_error = '', summary_body = '', summary_status = 'none', summary_error = '' WHERE id = ?",
      ).run(title, body, page.id);
    } else {
      db.prepare("UPDATE note_pages SET title = ? WHERE id = ?").run(title, page.id);
    }
    const next = getPage(db, page.id);
    if (next === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (bodyChanged) {
      queuePageJobs(next, book, false);
    }
    const stored = getPage(db, page.id);
    if (stored === null) {
      return reply.code(404).send({ error: "not found" });
    }
    return stored;
  });

  app.delete<{ Params: { pageId: string } }>("/api/note-pages/:pageId", async (request, reply) => {
    const viewer = await viewerFrom(request, options);
    if (!viewer) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const page = getPage(db, request.params.pageId);
    if (page === null) {
      return reply.code(404).send({ error: "not found" });
    }
    const book = getBook(db, page.bookId);
    if (book === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (!canSeeProject(options, book.projectId, viewer.sub)) {
      return reply.code(404).send({ error: "not found" });
    }
    db.prepare("DELETE FROM note_pages WHERE id = ?").run(page.id);
    return { ok: true };
  });

  app.post<{ Params: { pageId: string } }>("/api/note-pages/:pageId/retry", async (request, reply) => {
    const viewer = await viewerFrom(request, options);
    if (!viewer) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const page = getPage(db, request.params.pageId);
    if (page === null) {
      return reply.code(404).send({ error: "not found" });
    }
    const book = getBook(db, page.bookId);
    if (book === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (!canSeeProject(options, book.projectId, viewer.sub)) {
      return reply.code(404).send({ error: "not found" });
    }
    const parsed = retrySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid retry" });
    }
    queuePageJobs(page, book, parsed.data.variant);
    const next = getPage(db, page.id);
    if (next === null) {
      return reply.code(404).send({ error: "not found" });
    }
    return next;
  });

  app.post<{ Params: { pageId: string } }>("/api/note-pages/:pageId/speak", async (request, reply) => {
    const viewer = await viewerFrom(request, options);
    if (!viewer) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const page = getPage(db, request.params.pageId);
    if (page === null) {
      return reply.code(404).send({ error: "not found" });
    }
    const book = getBook(db, page.bookId);
    if (book === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (!canSeeProject(options, book.projectId, viewer.sub)) {
      return reply.code(404).send({ error: "not found" });
    }
    const parsed = speakSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid speak request" });
    }
    const settings = loadAppSettings(settingsDb);
    const spoken = speakVariant(page, parsed.data.variant, settings);
    if (spoken.text.trim().length === 0) {
      return reply.code(400).send({ error: "Nothing to read" });
    }
    try {
      const audio = await synthesizeSpeech(settings, spoken.text, spoken.language);
      return reply.type("audio/mpeg").send(audio);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Speech failed";
      return reply.code(502).send({ error: message });
    }
  });
}

export function speakVariant(
  page: NotePage,
  variant: SpeakVariant,
  settings: AppSettings,
): { text: string; language: string } {
  if (variant === "translated") {
    return { text: page.translatedBody, language: settings.targetLanguage };
  }
  if (variant === "polished") {
    return { text: page.polishedBody, language: "tr" };
  }
  if (variant === "summary") {
    return { text: page.summaryBody, language: settings.targetLanguage };
  }
  return { text: page.body, language: settings.targetLanguage };
}
