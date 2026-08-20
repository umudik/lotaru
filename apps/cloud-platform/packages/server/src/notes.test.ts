import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { DEFAULT_APP_SETTINGS } from "./app-settings.js";
import { createIdentity } from "./modules/identity.js";
import {
  openNotesDb,
  registerNotesModule,
  speakVariant,
  type NotePage,
} from "./modules/notes.js";

const PROJECT_ID = "proj-notes";

function emptyPage(): NotePage {
  return {
    id: "page-1",
    bookId: "book-1",
    title: "Hello",
    body: "guzel kardesim",
    position: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    translatedBody: "beautiful sibling",
    translationStatus: "ready",
    translationError: "",
    polishedBody: "güzel kardeşim",
    polishStatus: "ready",
    polishError: "",
    summaryBody: "Kısa özet.",
    summaryStatus: "ready",
    summaryError: "",
  };
}

async function startNotes(access = true) {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-notes-"));
  const app = Fastify({ logger: false });
  const identity = await createIdentity({
    publicUrl: "http://127.0.0.1:4317",
    dataDir: dir,
  });
  await registerNotesModule(app, {
    databasePath: join(dir, "app.sqlite"),
    identity,
    projectAccess: () => access,
  });
  return { app, dir };
}

describe("speakVariant", () => {
  it("reads each output in its own language", () => {
    const page = emptyPage();
    const settings = Object.assign({}, DEFAULT_APP_SETTINGS, { targetLanguage: "en" });
    assert.deepEqual(speakVariant(page, "original", settings), {
      text: "guzel kardesim",
      language: "en",
    });
    assert.deepEqual(speakVariant(page, "translated", settings), {
      text: "beautiful sibling",
      language: "en",
    });
    assert.deepEqual(speakVariant(page, "polished", settings), {
      text: "güzel kardeşim",
      language: "tr",
    });
    assert.deepEqual(speakVariant(page, "summary", settings), {
      text: "Kısa özet.",
      language: "en",
    });
  });
});

describe("openNotesDb", () => {
  it("moves legacy notes into an Inbox book per project", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-notes-legacy-"));
    const databasePath = join(dir, "app.sqlite");
    const seed = new Database(databasePath);
    seed.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        translated_body TEXT NOT NULL DEFAULT '',
        translation_status TEXT NOT NULL DEFAULT 'none',
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        project_id TEXT NOT NULL
      );
    `);
    seed
      .prepare(
        "INSERT INTO notes (id, title, body, translated_body, translation_status, created_at, created_by, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "legacy-1",
        "First",
        "Hello page",
        "Merhaba",
        "ready",
        "2026-02-01T00:00:00.000Z",
        "local@lotaru",
        PROJECT_ID,
      );
    seed.close();
    const db = openNotesDb(databasePath);
    const books = db.prepare("SELECT title, project_id FROM note_books").all() as {
      title: string;
      project_id: string;
    }[];
    const pages = db.prepare("SELECT id, title, body, translated_body FROM note_pages").all() as {
      id: string;
      title: string;
      body: string;
      translated_body: string;
    }[];
    db.close();
    assert.equal(books.length, 1);
    assert.equal(books[0]?.title, "Inbox");
    assert.equal(books[0]?.project_id, PROJECT_ID);
    assert.equal(pages.length, 1);
    assert.equal(pages[0]?.id, "legacy-1");
    assert.equal(pages[0]?.body, "Hello page");
    assert.equal(pages[0]?.translated_body, "Merhaba");
  });

  it("turns factory-off job switches on once", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-notes-jobs-on-"));
    const databasePath = join(dir, "app.sqlite");
    const seed = new Database(databasePath);
    seed.exec(`
      CREATE TABLE note_books (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        translate_on INTEGER NOT NULL DEFAULT 0,
        polish_on INTEGER NOT NULL DEFAULT 0,
        summarize_on INTEGER NOT NULL DEFAULT 0
      );
    `);
    seed
      .prepare(
        "INSERT INTO note_books (id, project_id, title, created_at, created_by, translate_on, polish_on, summarize_on) VALUES (?, ?, ?, ?, ?, 0, 0, 0)",
      )
      .run("book-off", PROJECT_ID, "Travel", "2026-02-01T00:00:00.000Z", "local@lotaru");
    seed.close();
    const first = openNotesDb(databasePath);
    const afterOpen = first
      .prepare("SELECT translate_on, polish_on, summarize_on FROM note_books WHERE id = ?")
      .get("book-off") as { translate_on: number; polish_on: number; summarize_on: number };
    assert.equal(afterOpen.translate_on, 1);
    assert.equal(afterOpen.polish_on, 1);
    assert.equal(afterOpen.summarize_on, 1);
    first
      .prepare("UPDATE note_books SET translate_on = 0, polish_on = 0, summarize_on = 0 WHERE id = ?")
      .run("book-off");
    first.close();
    const second = openNotesDb(databasePath);
    const afterSecond = second
      .prepare("SELECT translate_on, polish_on, summarize_on FROM note_books WHERE id = ?")
      .get("book-off") as { translate_on: number; polish_on: number; summarize_on: number };
    second.close();
    assert.equal(afterSecond.translate_on, 0);
    assert.equal(afterSecond.polish_on, 0);
    assert.equal(afterSecond.summarize_on, 0);
  });

  it("adds job error columns to existing pages", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-notes-job-err-"));
    const databasePath = join(dir, "app.sqlite");
    const seed = new Database(databasePath);
    seed.exec(`
      CREATE TABLE note_books (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        translate_on INTEGER NOT NULL DEFAULT 1,
        polish_on INTEGER NOT NULL DEFAULT 1,
        summarize_on INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE note_pages (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        translated_body TEXT NOT NULL DEFAULT '',
        translation_status TEXT NOT NULL DEFAULT 'none',
        polished_body TEXT NOT NULL DEFAULT '',
        polish_status TEXT NOT NULL DEFAULT 'none',
        summary_body TEXT NOT NULL DEFAULT '',
        summary_status TEXT NOT NULL DEFAULT 'none',
        FOREIGN KEY (book_id) REFERENCES note_books(id) ON DELETE CASCADE
      );
    `);
    seed
      .prepare(
        "INSERT INTO note_books (id, project_id, title, created_at, created_by) VALUES (?, ?, ?, ?, ?)",
      )
      .run("book-1", PROJECT_ID, "Travel", "2026-02-01T00:00:00.000Z", "local@lotaru");
    seed
      .prepare(
        "INSERT INTO note_pages (id, book_id, title, body, position, created_at, translation_status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("page-1", "book-1", "One", "hello", 1, "2026-02-01T00:00:00.000Z", "error");
    seed.close();
    const db = openNotesDb(databasePath);
    const page = db
      .prepare("SELECT translation_error, polish_error, summary_error FROM note_pages WHERE id = ?")
      .get("page-1") as { translation_error: string; polish_error: string; summary_error: string };
    db.close();
    assert.equal(page.translation_error, "");
    assert.equal(page.polish_error, "");
    assert.equal(page.summary_error, "");
  });
});

describe("note books", () => {
  it("creates a book with jobs on, then a page that queues them", async (t) => {
    const { app } = await startNotes();
    t.after(async () => {
      await app.close();
    });
    const createdBook = await app.inject({
      method: "POST",
      url: "/api/note-books",
      payload: { projectId: PROJECT_ID, title: "Travel" },
    });
    assert.equal(createdBook.statusCode, 201);
    const book = createdBook.json();
    assert.equal(book.title, "Travel");
    assert.equal(book.translateOn, true);
    assert.equal(book.polishOn, true);
    assert.equal(book.summarizeOn, true);
    assert.equal(book.pages.length, 0);
    const createdPage = await app.inject({
      method: "POST",
      url: `/api/note-books/${book.id}/pages`,
      payload: { body: "guzel bir gun" },
    });
    assert.equal(createdPage.statusCode, 201);
    const page = createdPage.json();
    assert.equal(page.body, "guzel bir gun");
    assert.equal(page.translationStatus, "error");
    assert.equal(page.translationError, "Choose an Ollama model in Settings");
    assert.equal(page.polishStatus, "error");
    assert.equal(page.summaryStatus, "error");
    const secondPage = await app.inject({
      method: "POST",
      url: `/api/note-books/${book.id}/pages`,
      payload: { body: "ikinci yapiştirma" },
    });
    assert.equal(secondPage.statusCode, 201);
    assert.equal(secondPage.json().body, "ikinci yapiştirma");
    const listed = await app.inject({
      method: "GET",
      url: `/api/note-books?projectId=${PROJECT_ID}`,
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().books.length, 1);
    assert.equal(listed.json().books[0].pageCount, 2);
  });

  it("runs only the switched-on job when Ollama has no model", async (t) => {
    const { app } = await startNotes();
    t.after(async () => {
      await app.close();
    });
    const createdBook = await app.inject({
      method: "POST",
      url: "/api/note-books",
      payload: { projectId: PROJECT_ID, title: "Inbox" },
    });
    const book = createdBook.json();
    const isolated = await app.inject({
      method: "PATCH",
      url: `/api/note-books/${book.id}`,
      payload: { polishOn: false, summarizeOn: false },
    });
    assert.equal(isolated.statusCode, 200);
    assert.equal(isolated.json().translateOn, true);
    assert.equal(isolated.json().polishOn, false);
    assert.equal(isolated.json().summarizeOn, false);
    const createdPage = await app.inject({
      method: "POST",
      url: `/api/note-books/${book.id}/pages`,
      payload: { body: "kardesim nasilsin" },
    });
    const page = createdPage.json();
    assert.equal(page.translationStatus, "error");
    assert.equal(page.translationError, "Choose an Ollama model in Settings");
    assert.equal(page.polishStatus, "none");
    assert.equal(page.summaryStatus, "none");
    const polish = await app.inject({
      method: "PATCH",
      url: `/api/note-books/${book.id}`,
      payload: { polishOn: true },
    });
    assert.equal(polish.json().pages[0].id, page.id);
    assert.equal(polish.json().pages[0].polishStatus, "error");
    assert.equal(polish.json().pages[0].summaryStatus, "none");
  });

  it("edits a page, deletes a page, then deletes the book", async (t) => {
    const { app } = await startNotes();
    t.after(async () => {
      await app.close();
    });
    const createdBook = await app.inject({
      method: "POST",
      url: "/api/note-books",
      payload: { projectId: PROJECT_ID, title: "Drafts" },
    });
    const book = createdBook.json();
    const createdPage = await app.inject({
      method: "POST",
      url: `/api/note-books/${book.id}/pages`,
      payload: { body: "first paste" },
    });
    const page = createdPage.json();
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/note-pages/${page.id}`,
      payload: { title: "Renamed", body: "second paste" },
    });
    assert.equal(edited.statusCode, 200);
    assert.equal(edited.json().title, "Renamed");
    assert.equal(edited.json().body, "second paste");
    assert.equal(edited.json().translationStatus, "error");
    const removedPage = await app.inject({
      method: "DELETE",
      url: `/api/note-pages/${page.id}`,
    });
    assert.equal(removedPage.statusCode, 200);
    const opened = await app.inject({
      method: "GET",
      url: `/api/note-books/${book.id}`,
    });
    assert.equal(opened.json().pages.length, 0);
    const removedBook = await app.inject({
      method: "DELETE",
      url: `/api/note-books/${book.id}`,
    });
    assert.equal(removedBook.statusCode, 200);
    const missing = await app.inject({
      method: "GET",
      url: `/api/note-books/${book.id}`,
    });
    assert.equal(missing.statusCode, 404);
  });

  it("refuses to read an empty translation", async (t) => {
    const { app } = await startNotes();
    t.after(async () => {
      await app.close();
    });
    const createdBook = await app.inject({
      method: "POST",
      url: "/api/note-books",
      payload: { projectId: PROJECT_ID, title: "Voice" },
    });
    const book = createdBook.json();
    const createdPage = await app.inject({
      method: "POST",
      url: `/api/note-books/${book.id}/pages`,
      payload: { body: "okunacak metin" },
    });
    const page = createdPage.json();
    const spoken = await app.inject({
      method: "POST",
      url: `/api/note-pages/${page.id}/speak`,
      payload: { variant: "translated" },
    });
    assert.equal(spoken.statusCode, 400);
    assert.equal(spoken.json().error, "Nothing to read");
  });

  it("hides books when the project is not visible", async (t) => {
    const { app } = await startNotes(false);
    t.after(async () => {
      await app.close();
    });
    const listed = await app.inject({
      method: "GET",
      url: `/api/note-books?projectId=${PROJECT_ID}`,
    });
    assert.equal(listed.statusCode, 404);
  });
});
