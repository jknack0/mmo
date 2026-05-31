import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { WebSocketServer, WebSocket as NodeWebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import {
  decodeClientMessage,
  encodeServerMessage,
  type ServerMessage,
} from '@mmo/protocol';
import { createChannelClient } from './channel-client.js';

describe('ChannelClient', () => {
  let wss: WebSocketServer;
  let url: string;
  // Latest connected server-side socket — tests use this to push messages.
  let serverSocket: NodeWebSocket | null = null;
  const serverInbox: Uint8Array[] = [];

  beforeAll(async () => {
    wss = new WebSocketServer({ port: 0 });
    wss.on('connection', (sock) => {
      serverSocket = sock;
      // Binary wire (S23): keep the raw frame bytes for the decoder.
      sock.on('message', (data) => serverInbox.push(data as Uint8Array));
    });
    await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
    const addr = wss.address() as AddressInfo;
    url = `ws://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) =>
      wss.close(() => resolve())
    );
  });

  it('opens a connection and reports status open', async () => {
    serverSocket = null;
    const statuses: string[] = [];
    const client = createChannelClient({
      wsUrl: url,
      WebSocket: NodeWebSocket as unknown as typeof WebSocket,
    });
    client.onStatusChange((s) => statuses.push(s));
    await vi.waitFor(() => expect(statuses).toContain('open'), {
      timeout: 1000,
      interval: 25,
    });
    client.close();
  });

  it('sends an encoded ClientMessage to the server', async () => {
    serverInbox.length = 0;
    serverSocket = null;
    const client = createChannelClient({
      wsUrl: url,
      WebSocket: NodeWebSocket as unknown as typeof WebSocket,
    });
    await vi.waitFor(() => expect(serverSocket).not.toBeNull(), {
      timeout: 1000, interval: 25,
    });
    client.send({
      type: 'hello',
      sessionToken: 't',
      characterId: 'c',
      name: 'Alice',
    });
    await vi.waitFor(() => expect(serverInbox.length).toBe(1), {
      timeout: 1000, interval: 25,
    });
    const decoded = decodeClientMessage(serverInbox[0]!);
    expect(decoded).toEqual({
      type: 'hello',
      sessionToken: 't',
      characterId: 'c',
      name: 'Alice',
    });
    client.close();
  });

  it('forwards decoded ServerMessages to onMessage handlers', async () => {
    serverSocket = null;
    const client = createChannelClient({
      wsUrl: url,
      WebSocket: NodeWebSocket as unknown as typeof WebSocket,
    });
    await vi.waitFor(() => expect(serverSocket).not.toBeNull(), {
      timeout: 1000, interval: 25,
    });

    const received: ServerMessage[] = [];
    client.onMessage((m) => received.push(m));

    const payload: ServerMessage = { type: 'error', reason: 'test-error' };
    serverSocket!.send(encodeServerMessage(payload));

    await vi.waitFor(() => expect(received).toEqual([payload]), {
      timeout: 1000, interval: 25,
    });
    client.close();
  });

  it('unsubscribes handlers via the returned disposer', async () => {
    serverSocket = null;
    const client = createChannelClient({
      wsUrl: url,
      WebSocket: NodeWebSocket as unknown as typeof WebSocket,
    });
    await vi.waitFor(() => expect(serverSocket).not.toBeNull(), {
      timeout: 1000, interval: 25,
    });

    const received: ServerMessage[] = [];
    const off = client.onMessage((m) => received.push(m));
    off();
    serverSocket!.send(encodeServerMessage({ type: 'error', reason: 'ignored' }));

    // Give a beat for the unhandled message to be delivered + not pushed.
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toEqual([]);
    client.close();
  });

  it('reports status closed after close()', async () => {
    serverSocket = null;
    const statuses: string[] = [];
    const client = createChannelClient({
      wsUrl: url,
      WebSocket: NodeWebSocket as unknown as typeof WebSocket,
    });
    client.onStatusChange((s) => statuses.push(s));
    await vi.waitFor(() => expect(statuses).toContain('open'), {
      timeout: 1000, interval: 25,
    });
    client.close();
    await vi.waitFor(() => expect(statuses).toContain('closed'), {
      timeout: 1000, interval: 25,
    });
  });
});
