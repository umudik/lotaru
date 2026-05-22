import type { ServerMessage } from '../types.js';

export type StreamListener = (msg: ServerMessage) => void;

export interface Stream {
  subscribe(listener: StreamListener): () => void;
  close(): void;
}

export function connectStream(): Stream {
  const listeners = new Set<StreamListener>();
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: number | null = null;

  function open(): void {
    let proto = 'ws';
    if (window.location.protocol === 'https:') {
      proto = 'wss';
    }
    const url = `${proto}://${window.location.host}/api/v1/stream`;
    const socket = new WebSocket(url);
    ws = socket;
    socket.onmessage = (ev: MessageEvent<string>) => {
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(ev.data) as ServerMessage;
      } catch (_e: unknown) {
        return;
      }
      for (const l of listeners) {
        l(parsed);
      }
    };
    socket.onclose = () => {
      if (closed) {
        return;
      }
      reconnectTimer = window.setTimeout(open, 1000);
    };
    socket.onerror = () => {
      socket.close();
    };
  }

  open();

  return {
    subscribe(listener: StreamListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close(): void {
      closed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (ws !== null) {
        ws.close();
      }
    },
  };
}
