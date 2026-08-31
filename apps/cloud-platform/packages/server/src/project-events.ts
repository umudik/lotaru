import { tryPublishLotaruEvent } from "./event-bus.js";
import {
  EVENT_NOTE_BOOK_CREATED,
  EVENT_NOTE_PAGE_CREATED,
  EVENT_TASK_CREATED,
} from "./events.js";

export function emitTaskCreated(input: {
  projectId: string;
  taskId: number;
  title: string;
}): void {
  tryPublishLotaruEvent(
    {
      type: EVENT_TASK_CREATED,
      projectId: input.projectId,
      scriptId: "",
      path: String(input.taskId),
      detail: input.title.slice(0, 500),
    },
    "live",
  );
}

export function emitNoteBookCreated(input: {
  projectId: string;
  bookId: string;
  title: string;
}): void {
  tryPublishLotaruEvent(
    {
      type: EVENT_NOTE_BOOK_CREATED,
      projectId: input.projectId,
      scriptId: "",
      path: input.bookId,
      detail: input.title.slice(0, 500),
    },
    "live",
  );
}

export function emitNotePageCreated(input: {
  projectId: string;
  bookId: string;
  pageId: string;
  pageTitle: string;
}): void {
  const detail = `${input.pageId}:${input.pageTitle}`.slice(0, 500);
  tryPublishLotaruEvent(
    {
      type: EVENT_NOTE_PAGE_CREATED,
      projectId: input.projectId,
      scriptId: "",
      path: input.bookId,
      detail,
    },
    "live",
  );
}
