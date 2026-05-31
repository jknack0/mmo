// Client-side WebSocket wrapper for the channel server. Exposes a typed
// message stream and the connection status. Reconnect logic deferred until
// a real disconnect-recovery story is needed; alpha keeps it linear.

import {
  encodeClientMessage,
  decodeServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '@mmo/protocol';

export type ConnStatus = 'connecting' | 'open' | 'closed';

export interface ChannelClient {
  send(msg: ClientMessage): void;
  onMessage(handler: (m: ServerMessage) => void): () => void;
  onStatusChange(handler: (s: ConnStatus) => void): () => void;
  status(): ConnStatus;
  close(): void;
}

export interface ChannelClientOptions {
  wsUrl: string;
  /** Injectable for tests. Defaults to `globalThis.WebSocket`. */
  WebSocket?: typeof WebSocket;
}

export function createChannelClient(opts: ChannelClientOptions): ChannelClient {
  const WS = opts.WebSocket ?? (globalThis as { WebSocket: typeof WebSocket }).WebSocket;
  if (!WS) throw new Error('No WebSocket implementation available');

  const messageHandlers = new Set<(m: ServerMessage) => void>();
  const statusHandlers = new Set<(s: ConnStatus) => void>();
  let status: ConnStatus = 'connecting';

  const ws = new WS(opts.wsUrl);
  // Binary wire (S23): receive frames as ArrayBuffer so the binary decoder gets
  // raw bytes. JSON dev frames still arrive as bytes and decode transparently.
  ws.binaryType = 'arraybuffer';

  function setStatus(next: ConnStatus): void {
    status = next;
    for (const h of statusHandlers) h(next);
  }

  ws.addEventListener('open', () => setStatus('open'));
  ws.addEventListener('close', () => setStatus('closed'));
  ws.addEventListener('error', () => {
    // Error events generally precede close; rely on close for the status flip.
  });
  ws.addEventListener('message', (ev) => {
    // ev.data is an ArrayBuffer (binary frame) or string (legacy JSON) — the
    // decoder handles both via the magic byte.
    let msg: ServerMessage;
    try {
      msg = decodeServerMessage(ev.data as ArrayBuffer | string);
    } catch {
      // Malformed; ignore.
      return;
    }
    for (const h of messageHandlers) h(msg);
  });

  return {
    send(msg) {
      if (ws.readyState === ws.OPEN) {
        ws.send(encodeClientMessage(msg));
      }
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onStatusChange(handler) {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },
    status: () => status,
    close() {
      try {
        ws.close();
      } catch {
        // Already closed.
      }
    },
  };
}
