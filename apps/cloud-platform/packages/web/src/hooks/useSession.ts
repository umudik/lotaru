import { useState } from "react";
import { loadSession, type Session } from "@/lib/session";

export function useSession(): Session {
  const [session] = useState(() => loadSession());
  return session;
}
