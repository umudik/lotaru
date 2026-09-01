import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { EmptyStatePanel } from "@/components/EmptyStatePanel";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageContent } from "@/components/layout/PageContent";
import { useSession } from "@/hooks/useSession";
import { getAccessToken } from "@/lib/auth";

type TerminalMessage = {
  type: string;
  data?: string;
  cwd?: string;
  code?: number;
};

function terminalSocketUrl(projectId: string): string {
  let proto = "ws";
  if (window.location.protocol === "https:") {
    proto = "wss";
  }
  return `${proto}://${window.location.host}/api/projects/${encodeURIComponent(projectId)}/terminal/ws`;
}

export function TerminalFeature(props: { projectId: string }): React.JSX.Element {
  const session = useSession();
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [cwd, setCwd] = useState("");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(true);
  const outputRef = useRef<HTMLPreElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (session === null) {
      return;
    }
    setConnecting(true);
    setConnected(false);
    setOutput("");
    setCwd("");
    setError("");
    const token = getAccessToken();
    const url = terminalSocketUrl(props.projectId);
    const socket =
      token !== null
        ? new WebSocket(url, ["bearer", token])
        : new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      setConnecting(false);
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      let parsed: TerminalMessage = { type: "output" };
      try {
        parsed = JSON.parse(event.data) as TerminalMessage;
      } catch {
        parsed = { type: "output", data: event.data };
      }
      if (parsed.type === "hello" && typeof parsed.cwd === "string") {
        setCwd(parsed.cwd);
        setOutput((current) => `${current}Connected in ${parsed.cwd}\n`);
        return;
      }
      if (parsed.type === "error" && typeof parsed.data === "string") {
        setError(parsed.data);
        return;
      }
      if (parsed.type === "output" && typeof parsed.data === "string") {
        setOutput((current) => current + parsed.data);
      }
      if (parsed.type === "exit") {
        setOutput((current) => `${current}\n[process exited]\n`);
        setConnected(false);
      }
    };

    socket.onerror = () => {
      setError("Terminal connection failed");
      setConnecting(false);
      setConnected(false);
    };

    socket.onclose = () => {
      setConnected(false);
      setConnecting(false);
    };

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [session, props.projectId]);

  useEffect(() => {
    const node = outputRef.current;
    if (node === null) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [output]);

  function sendInput(line: string): void {
    const socket = socketRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify({ type: "input", data: line }));
  }

  const shellUnavailable = connecting !== true && connected !== true && error.length > 0;
  let prePlaceholder = "Waiting for shell output…";
  if (connecting) {
    prePlaceholder = "Connecting to host shell…";
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Terminal"
        info="Host shell in the project folder. Runs commands on this machine."
      />
      <PageContent className="flex flex-col">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          {connecting ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Connecting…
            </>
          ) : connected ? (
            <span className="text-success">Connected{cwd.length > 0 ? ` · ${cwd}` : ""}</span>
          ) : (
            <span className="text-destructive">Disconnected</span>
          )}
        </div>
        {shellUnavailable ? (
          <EmptyStatePanel
            title="Shell unavailable"
            description={error}
          />
        ) : (
          <>
            <InlineErrorBanner message={connected ? error : ""} />
            <pre
              ref={outputRef}
              className="panel-card mb-3 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed"
            >
              {output.length > 0 ? output : prePlaceholder}
            </pre>
          </>
        )}
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const line = input;
            if (line.length === 0) {
              return;
            }
            sendInput(`${line}\n`);
            setInput("");
          }}
        >
          <input
            value={input}
            disabled={!connected}
            placeholder={connected ? "Type a command and press Enter" : "Terminal unavailable"}
            className="panel-card h-10 flex-1 px-3 font-mono text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            onChange={(event) => {
              setInput(event.target.value);
            }}
          />
        </form>
      </PageContent>
    </div>
  );
}
