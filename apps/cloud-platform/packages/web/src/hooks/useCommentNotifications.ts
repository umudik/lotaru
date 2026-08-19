import { useCallback, useEffect, useState } from "react";
import type { InboxItem } from "@/lib/api";
import type { Session } from "@/lib/session";

export function useCommentNotifications(_session: Session | null, _projectId: string | null) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Inbox requests disabled — /api/inbox was taking 3-16s per request and polling every 10s.
  // Root cause: SQLite query SELECT * FROM tasks pulls entire table into memory,
  // then filters and sorts in JS. Pagination also happens entirely in memory.
  const refresh = useCallback(async (_silent = false) => {
    setItems([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh(false);
    const timer = window.setInterval(() => void refresh(true), 10000);
    const onRead = () => void refresh(true);
    window.addEventListener("task-bridge:read", onRead);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("task-bridge:read", onRead);
    };
  }, [refresh]);

  const commentItems = items.filter((item) => item.commentCount > 0);
  const openItems = items.filter((item) => item.status === "sent");

  return { items, commentItems, openItems, loading, refresh };
}
