// The host half of the guest's WebSocket.
//
// A worker whose network client is written for the browser (the Nym worker
// opens a WebSocket to its entry gateway) needs a WebSocket, and under this
// isolation strategy the guest has none of its own. The host opens it, under
// the same address policy as `fetch` and `socket`, and relays frames: the
// guest pulls one event per `ws.recv`, so nothing is buffered beyond what the
// guest has asked for.
//
// The name is resolved and the resolved address checked before connecting.
// The connection itself is then made by name, because TLS needs the name for
// SNI and certificate checks, which leaves the same resolve-then-connect
// window the socket bridge avoids by dialling the checked address.

import { lookup } from "node:dns/promises";
import { Policy, type AddressPolicy } from "./address-policy.js";
import type { Rpc } from "../protocol.js";
import type { GuestPayload, GuestReply } from "../child/isolate-thread.js";

export type WebSocketBridgeOptions = {
  policy?: AddressPolicy;
  maxConcurrent?: number;
};

const DEFAULT_MAX_CONCURRENT = 16;

type GuestEvent =
  | { type: "message"; text?: string; bytes?: Uint8Array }
  | { type: "close"; code: number; reason: string; wasClean: boolean }
  | { type: "error" };

type Bridged = { ws: WebSocket; queue: GuestEvent[]; waiter?: () => void; closed: boolean };

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export function installWebSocketBridge(rpc: Rpc, opts: WebSocketBridgeOptions = {}): () => void {
  const policy = new Policy(opts.policy);
  const max = opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const live = new Map<number, Bridged>();
  let nextId = 1;

  const get = (payload: GuestPayload): [number, Bridged] => {
    const id = (payload?.args as { id?: number })?.id;
    const b = typeof id === "number" ? live.get(id) : undefined;
    if (!b) throw coded("protocol-error", `websocket: no such socket (${String(id)})`);
    return [id!, b];
  };

  const push = (b: Bridged, ev: GuestEvent) => {
    b.queue.push(ev);
    b.waiter?.();
    b.waiter = undefined;
  };

  rpc.on("ws.connect", async (payload: GuestPayload) => {
    const { url, protocols } = (payload?.args ?? {}) as { url?: unknown; protocols?: unknown };
    let u: URL;
    try {
      u = new URL(String(url));
    } catch {
      throw coded("protocol-error", `ws.connect: bad url (${String(url)})`);
    }
    if (u.protocol !== "wss:" && u.protocol !== "ws:") throw coded("protocol-error", `ws.connect: not a websocket url (${u.protocol})`);
    if (live.size >= max) throw coded("queue-full", `ws.connect: ${max} websockets already open`);

    const host = u.hostname.replace(/^\[|\]$/g, "");
    let address: string;
    try {
      ({ address } = await lookup(host, { verbatim: true }));
    } catch (e) {
      throw coded("network-error", `ws.connect: cannot resolve ${host}: ${(e as Error).message}`);
    }
    const decision = policy.check(address);
    if (!decision.ok) throw coded("permission-denied", `ws.connect: ${host} → ${decision.why}`);

    const ws = new WebSocket(u.href, Array.isArray(protocols) ? protocols.map(String) : []);
    ws.binaryType = "arraybuffer";
    const b: Bridged = { ws, queue: [], closed: false };
    await new Promise<void>((ok, fail) => {
      ws.addEventListener("open", () => ok(), { once: true });
      ws.addEventListener("error", () => fail(coded("network-error", `ws.connect: ${u.host} refused or unreachable`)), { once: true });
    });
    const id = nextId++;
    live.set(id, b);
    ws.addEventListener("message", (ev) => {
      const d = ev.data;
      push(b, typeof d === "string" ? { type: "message", text: d } : { type: "message", bytes: new Uint8Array(d as ArrayBuffer) });
    });
    ws.addEventListener("error", () => push(b, { type: "error" }));
    ws.addEventListener("close", (ev) => {
      b.closed = true;
      push(b, { type: "close", code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
    });
    return { value: { id, protocol: ws.protocol, extensions: ws.extensions } } satisfies GuestReply;
  });

  rpc.on("ws.recv", async (payload: GuestPayload) => {
    const [id, b] = get(payload);
    while (!b.queue.length) await new Promise<void>((res) => (b.waiter = res));
    const ev = b.queue.shift()!;
    if (ev.type === "close") live.delete(id);
    if (ev.type === "message" && ev.bytes) return { value: { type: "message", binary: true }, bytes: ev.bytes } satisfies GuestReply;
    return { value: ev } satisfies GuestReply;
  });

  rpc.onEvent("ws.send", (payload: GuestPayload) => {
    const id = (payload?.args as { id?: number })?.id;
    const b = typeof id === "number" ? live.get(id) : undefined;
    if (!b || b.closed || b.ws.readyState !== WebSocket.OPEN) return;
    const text = (payload.args as { text?: unknown }).text;
    b.ws.send(typeof text === "string" ? text : (payload.bytes ?? new Uint8Array()));
  });

  rpc.onEvent("ws.close", (payload: GuestPayload) => {
    const { id, code, reason } = (payload?.args ?? {}) as { id?: number; code?: number; reason?: string };
    const b = typeof id === "number" ? live.get(id) : undefined;
    if (!b || b.closed) return;
    try {
      b.ws.close(code, reason);
    } catch {
      b.ws.close();
    }
  });

  return () => {
    for (const b of live.values()) {
      try {
        b.ws.close();
      } catch {
        /* already closing */
      }
    }
    live.clear();
  };
}
