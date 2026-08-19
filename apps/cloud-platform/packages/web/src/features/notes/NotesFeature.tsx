import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { Loader2, Pause, Play, Plus, RotateCcw, Settings, Trash2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAccessToken } from "@/lib/auth";
import { fetchAppSettings } from "@/lib/api";
import { useSession } from "@/hooks/useSession";
import { cn } from "@/lib/utils";

type JobStatus = "none" | "pending" | "ready" | "error";
type SpeakVariant = "original" | "translated" | "polished" | "summary";

type NoteBookListItem = {
  id: string;
  title: string;
  createdAt: string;
  pageCount: number;
  translateOn: boolean;
  polishOn: boolean;
  summarizeOn: boolean;
};

type NotePage = {
  id: string;
  bookId: string;
  title: string;
  body: string;
  position: number;
  createdAt: string;
  translatedBody: string;
  translationStatus: JobStatus;
  polishedBody: string;
  polishStatus: JobStatus;
  summaryBody: string;
  summaryStatus: JobStatus;
};

type NoteBook = NoteBookListItem & {
  projectId: string;
  pages: NotePage[];
};

function notesBase(projectId: string): string {
  return `/projects/${projectId}/notes`;
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  const token = getAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, Object.assign({}, options, { headers }));
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `http ${res.status}`);
  }
  return data;
}

function statusLabel(status: JobStatus): string {
  if (status === "pending") {
    return "Working";
  }
  if (status === "ready") {
    return "Ready";
  }
  if (status === "error") {
    return "Failed";
  }
  return "Off";
}

function pagePending(page: NotePage): boolean {
  return (
    page.translationStatus === "pending" ||
    page.polishStatus === "pending" ||
    page.summaryStatus === "pending"
  );
}

function NotesStudio(props: { projectId: string }): React.JSX.Element {
  const params = useParams();
  const bookId = params["bookId"];
  const pageId = params["pageId"];
  const navigate = useNavigate();
  const session = useSession();
  const base = notesBase(props.projectId);
  const [books, setBooks] = useState<NoteBookListItem[]>([]);
  const [book, setBook] = useState<NoteBook | null>(null);
  const [draft, setDraft] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [pageBody, setPageBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const loadBooks = useCallback(async (): Promise<void> => {
    const query = new URLSearchParams({ projectId: props.projectId });
    const data = await api<{ books: NoteBookListItem[] }>(`/api/note-books?${query.toString()}`);
    setBooks(data.books);
  }, [props.projectId]);

  const loadBook = useCallback(async (id: string): Promise<NoteBook> => {
    const next = await api<NoteBook>(`/api/note-books/${id}`);
    setBook(next);
    return next;
  }, []);

  useEffect(() => {
    void loadBooks().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "load failed");
    });
  }, [loadBooks]);

  useEffect(() => {
    void fetchAppSettings(session).catch(() => undefined);
  }, [session]);

  useEffect(() => {
    if (typeof bookId !== "string" || bookId.length === 0) {
      setBook(null);
      return;
    }
    void loadBook(bookId).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "open failed");
    });
  }, [bookId, loadBook]);

  const selected = book !== null && typeof pageId === "string" ? book.pages.find((page) => page.id === pageId) : undefined;

  useEffect(() => {
    setEditing(false);
  }, [pageId]);

  useEffect(() => {
    if (selected === undefined) {
      setPageTitle("");
      setPageBody("");
      return;
    }
    if (editing) {
      return;
    }
    setPageTitle(selected.title);
    setPageBody(selected.body);
  }, [selected, editing]);

  const shouldPoll = book !== null && book.pages.some(pagePending);

  useEffect(() => {
    if (!shouldPoll || typeof bookId !== "string") {
      return;
    }
    const timer = window.setInterval(() => {
      void loadBook(bookId);
      void loadBooks();
    }, 800);
    return () => {
      window.clearInterval(timer);
    };
  }, [shouldPoll, bookId, loadBook, loadBooks]);

  useEffect(() => {
    return () => {
      if (audioRef.current !== null) {
        audioRef.current.pause();
      }
      if (objectUrlRef.current !== null) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  async function createBook(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const created = await api<NoteBook>("/api/note-books", {
        method: "POST",
        body: JSON.stringify({ projectId: props.projectId, title: bookTitle }),
      });
      setBookTitle("");
      await loadBooks();
      navigate(`${base}/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setSaving(false);
    }
  }

  async function addPage(): Promise<void> {
    if (book === null) {
      return;
    }
    const body = draft.trim();
    if (body.length === 0) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const page = await api<NotePage>(`/api/note-books/${book.id}/pages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setDraft("");
      await loadBook(book.id);
      await loadBooks();
      navigate(`${base}/${book.id}/${page.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "page failed");
    } finally {
      setSaving(false);
    }
  }

  async function setSwitch(
    field: "translateOn" | "polishOn" | "summarizeOn",
    value: boolean,
  ): Promise<void> {
    if (book === null) {
      return;
    }
    try {
      const next = await api<NoteBook>(`/api/note-books/${book.id}`, {
        method: "PATCH",
        body: JSON.stringify({ [field]: value }),
      });
      setBook(next);
      await loadBooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "switch failed");
    }
  }

  async function savePage(): Promise<void> {
    if (selected === undefined) {
      return;
    }
    setSaving(true);
    try {
      let title = pageTitle.trim();
      if (title.length === 0) {
        title = selected.title;
      }
      const body = pageBody.trim();
      if (body.length === 0) {
        setError("Page text is required");
        setSaving(false);
        return;
      }
      await api<NotePage>(`/api/note-pages/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, body }),
      });
      if (book !== null) {
        await loadBook(book.id);
      }
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deletePage(): Promise<void> {
    if (selected === undefined || book === null) {
      return;
    }
    try {
      await api<{ ok: boolean }>(`/api/note-pages/${selected.id}`, { method: "DELETE" });
      await loadBook(book.id);
      await loadBooks();
      navigate(`${base}/${book.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  async function deleteBook(): Promise<void> {
    if (book === null) {
      return;
    }
    try {
      await api<{ ok: boolean }>(`/api/note-books/${book.id}`, { method: "DELETE" });
      setBook(null);
      await loadBooks();
      navigate(base);
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  async function retry(variant: "translate" | "polish" | "summary"): Promise<void> {
    if (selected === undefined) {
      return;
    }
    try {
      await api<NotePage>(`/api/note-pages/${selected.id}/retry`, {
        method: "POST",
        body: JSON.stringify({ variant }),
      });
      if (book !== null) {
        await loadBook(book.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "retry failed");
    }
  }

  async function speak(variant: SpeakVariant): Promise<void> {
    if (selected === undefined) {
      return;
    }
    const key = `${selected.id}:${variant}`;
    if (audioRef.current !== null && paused && speakingKey === key) {
      await audioRef.current.play();
      setPaused(false);
      setSpeakingKey(key);
      return;
    }
    setSpeakingKey(key);
    setPaused(false);
    try {
      const headers = new Headers({ "Content-Type": "application/json" });
      const token = getAccessToken();
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      const res = await fetch(`/api/note-pages/${selected.id}/speak`, {
        method: "POST",
        headers,
        body: JSON.stringify({ variant }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Speech failed");
      }
      const blob = await res.blob();
      if (objectUrlRef.current !== null) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setSpeakingKey(null);
        setPaused(false);
      };
      await audio.play();
    } catch (err) {
      setSpeakingKey(null);
      setError(err instanceof Error ? err.message : "Speech failed");
    }
  }

  function pauseSpeech(): void {
    if (audioRef.current !== null) {
      audioRef.current.pause();
    }
    setPaused(true);
  }

  return (
    <div className="note-desk flex min-h-0 flex-1">
      <aside className="flex w-[18rem] shrink-0 flex-col border-r border-border/70">
        <div className="flex items-start justify-between gap-3 px-4 py-5">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Notes</h1>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Create a book, then add pages.
            </p>
          </div>
          <Link
            to="/settings"
            className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
        <form
          className="flex gap-2 px-4 pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            void createBook();
          }}
        >
          <Input
            value={bookTitle}
            placeholder="New book title"
            onChange={(event) => {
              setBookTitle(event.target.value);
            }}
          />
          <Button type="submit" size="icon" disabled={saving}>
            <Plus className="h-4 w-4" />
          </Button>
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {books.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">No books yet.</p>
          ) : (
            books.map((item) => (
              <Link
                key={item.id}
                to={`${base}/${item.id}`}
                className={cn(
                  "mb-1 block rounded-xl px-3 py-3 transition-colors",
                  item.id === bookId ? "bg-secondary text-foreground" : "hover:bg-secondary/50",
                )}
              >
                <p className="truncate text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {item.pageCount} pages · {fmt(item.createdAt)}
                </p>
              </Link>
            ))
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {book === null ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              Start with a book. Pages you paste live inside it. Translate, polish, and summarize
              each stay as their own text, each with read aloud.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-6 py-3">
              <h2 className="mr-auto text-base font-semibold">{book.title}</h2>
              <SwitchButton
                label="Translate"
                on={book.translateOn}
                onClick={() => void setSwitch("translateOn", !book.translateOn)}
              />
              <SwitchButton
                label="Polish"
                on={book.polishOn}
                onClick={() => void setSwitch("polishOn", !book.polishOn)}
              />
              <SwitchButton
                label="Summary"
                on={book.summarizeOn}
                onClick={() => void setSwitch("summarizeOn", !book.summarizeOn)}
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => void deleteBook()}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <p className="border-b border-border/70 px-6 py-2 text-[11px] leading-relaxed text-muted-foreground">
              Translate uses the language in Settings. Polish keeps the meaning and restores
              Turkish characters. Summary shortens the same language. Each switch writes its own
              text, and each text can be read aloud.
            </p>
            <form
              className="border-b border-border/70 px-6 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                void addPage();
              }}
            >
              <textarea
                className="min-h-[6.5rem] w-full resize-none bg-transparent text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Paste a page, then add it. The box clears so you can paste the next one."
              />
              <div className="mt-3 flex items-center justify-between">
                {error ? <p className="text-xs text-destructive">{error}</p> : <span />}
                <Button type="submit" size="sm" disabled={saving || draft.trim().length === 0}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Add page
                </Button>
              </div>
            </form>
            <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[16rem_minmax(0,1fr)]">
              <div className="min-h-0 overflow-y-auto border-b border-border/60 px-3 py-3 lg:border-b-0 lg:border-r">
                {book.pages.length === 0 ? (
                  <p className="px-2 text-sm text-muted-foreground">No pages yet.</p>
                ) : (
                  book.pages.map((page) => (
                    <Link
                      key={page.id}
                      to={`${base}/${book.id}/${page.id}`}
                      className={cn(
                        "mb-1 block rounded-xl px-3 py-3 transition-colors",
                        page.id === pageId ? "bg-secondary text-foreground" : "hover:bg-secondary/50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{page.title}</p>
                        {pagePending(page) ? (
                          <span className="note-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                        ) : null}
                      </div>
                    </Link>
                  ))
                )}
              </div>
              <div className="min-h-0 overflow-y-auto px-6 py-6">
                {selected === undefined ? (
                  <p className="text-sm text-muted-foreground">Select a page, or add one from the paste box.</p>
                ) : (
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditing(!editing)}>
                        {editing ? "Cancel" : "Edit"}
                      </Button>
                      {editing ? (
                        <Button type="button" size="sm" disabled={saving} onClick={() => void savePage()}>
                          Save
                        </Button>
                      ) : null}
                      <Button type="button" variant="ghost" size="sm" onClick={() => void deletePage()}>
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                    {editing ? (
                      <div className="space-y-3">
                        <Input
                          value={pageTitle}
                          onChange={(event) => {
                            setPageTitle(event.target.value);
                          }}
                        />
                        <textarea
                          className="min-h-[12rem] w-full resize-y rounded-xl border border-white/[0.1] bg-[#111111] px-3 py-2 text-[15px] leading-7"
                          value={pageBody}
                          onChange={(event) => {
                            setPageBody(event.target.value);
                          }}
                        />
                      </div>
                    ) : (
                      <VariantCard
                        title="Original"
                        text={selected.body}
                        status="ready"
                        speaking={speakingKey === `${selected.id}:original` && !paused}
                        paused={paused && speakingKey === `${selected.id}:original`}
                        onSpeak={() => void speak("original")}
                        onPause={pauseSpeech}
                      />
                    )}
                    {book.translateOn || selected.translationStatus !== "none" ? (
                      <VariantCard
                        title="Translate"
                        text={selected.translatedBody}
                        status={selected.translationStatus}
                        speaking={speakingKey === `${selected.id}:translated` && !paused}
                        paused={paused && speakingKey === `${selected.id}:translated`}
                        onSpeak={() => void speak("translated")}
                        onPause={pauseSpeech}
                        onRetry={() => void retry("translate")}
                      />
                    ) : null}
                    {book.polishOn || selected.polishStatus !== "none" ? (
                      <VariantCard
                        title="Polish"
                        text={selected.polishedBody}
                        status={selected.polishStatus}
                        speaking={speakingKey === `${selected.id}:polished` && !paused}
                        paused={paused && speakingKey === `${selected.id}:polished`}
                        onSpeak={() => void speak("polished")}
                        onPause={pauseSpeech}
                        onRetry={() => void retry("polish")}
                      />
                    ) : null}
                    {book.summarizeOn || selected.summaryStatus !== "none" ? (
                      <VariantCard
                        title="Summary"
                        text={selected.summaryBody}
                        status={selected.summaryStatus}
                        speaking={speakingKey === `${selected.id}:summary` && !paused}
                        paused={paused && speakingKey === `${selected.id}:summary`}
                        onSpeak={() => void speak("summary")}
                        onPause={pauseSpeech}
                        onRetry={() => void retry("summary")}
                      />
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function SwitchButton(props: { label: string; on: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <Button
      type="button"
      size="sm"
      variant={props.on ? "default" : "outline"}
      aria-pressed={props.on}
      onClick={props.onClick}
    >
      {props.label}
    </Button>
  );
}

function VariantCard(props: {
  title: string;
  text: string;
  status: JobStatus;
  speaking: boolean;
  paused: boolean;
  onSpeak: () => void;
  onPause: () => void;
  onRetry?: () => void;
}): React.JSX.Element {
  return (
    <article className="rounded-2xl border border-white/[0.08] p-5">
      <div className="mb-3 flex items-center gap-2">
        <p className="text-sm font-medium">{props.title}</p>
        <span className="text-[11px] text-muted-foreground">{statusLabel(props.status)}</span>
        <div className="ml-auto flex items-center gap-2">
          {props.status === "error" && props.onRetry !== undefined ? (
            <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>
              <RotateCcw className="h-4 w-4" />
              Retry
            </Button>
          ) : null}
          {props.speaking ? (
            <Button type="button" size="sm" onClick={props.onPause}>
              <Pause className="h-4 w-4" />
              Pause
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={props.status === "pending" || props.text.trim().length === 0}
              onClick={props.onSpeak}
            >
              {props.paused ? <Play className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              {props.paused ? "Resume" : "Read aloud"}
            </Button>
          )}
        </div>
      </div>
      {props.status === "pending" ? (
        <p className="note-pulse text-sm text-warn">Waiting on Ollama…</p>
      ) : props.status === "error" ? (
        <p className="text-sm text-destructive">Ollama did not finish. Retry, or pick a model in Settings.</p>
      ) : (
        <p className="whitespace-pre-wrap text-[15px] leading-7 text-foreground/90">{props.text}</p>
      )}
    </article>
  );
}

export function NotesFeature(props: { projectId: string }): React.JSX.Element {
  const base = notesBase(props.projectId);
  return (
    <Routes>
      <Route index element={<NotesStudio projectId={props.projectId} />} />
      <Route path=":bookId" element={<NotesStudio projectId={props.projectId} />} />
      <Route path=":bookId/:pageId" element={<NotesStudio projectId={props.projectId} />} />
      <Route path="*" element={<Navigate to={base} replace />} />
    </Routes>
  );
}
